// POST /api/click
// Body: { "turnstileToken": "<token>" }
// Headers: X-CSRF-Token (from /api/state), Content-Type: application/json
//
// The actual press is ONE atomic D1 batch:
//   1. insert the click (database constraints enforce all rules)
//   2. increase the global counter
//   3. record a milestone if this click completed one
// If any statement fails, the whole batch is rolled back.

import { MILESTONES, MILESTONE_FALLBACK_STEP, RATE_LIMITS } from '../_lib/config.js';
import { ApiError, json, nowSeconds, readJson, utcDay } from '../_lib/http.js';
import { getNextMilestone, milestoneHitAt } from '../_lib/milestones.js';
import { enforceIpRateLimit, enforceUserRateLimit } from '../_lib/rate-limit.js';
import { requireCsrf, requireSession } from '../_lib/session.js';
import { requireTurnstile } from '../_lib/turnstile.js';

// --- Duplicated on purpose from state.js (keep in sync) --------------------
function nextUtcMidnightIso(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}

async function loadUserStatus(env, userId, day) {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM clicks WHERE user_id = ?1 AND kind = 'free') AS free_used,
       (SELECT COUNT(*) FROM clicks WHERE user_id = ?1 AND click_day = ?2) AS clicked_today,
       (SELECT COUNT(*) FROM credits c
          WHERE c.user_id = ?1
            AND NOT EXISTS (SELECT 1 FROM clicks k WHERE k.credit_id = c.id)) AS credits_remaining`,
  )
    .bind(userId, day)
    .first();

  return {
    freeUsed: row.free_used > 0,
    clickedToday: row.clicked_today > 0,
    creditsRemaining: row.credits_remaining,
  };
}

function buildUserView(status, csrfToken) {
  return {
    csrfToken,
    freeClickAvailable: !status.freeUsed,
    creditsRemaining: status.creditsRemaining,
    clickedToday: status.clickedToday,
    canClick: !status.clickedToday && (!status.freeUsed || status.creditsRemaining > 0),
    nextClickAt: nextUtcMidnightIso(),
  };
}
// ---------------------------------------------------------------------------

// Throws a precise, user-friendly error if the user may not click right now.
function assertEligible(status) {
  if (status.clickedToday) {
    throw new ApiError(
      409,
      'already_clicked_today',
      'You have already pressed the button today (UTC). Come back tomorrow.',
    );
  }
  if (status.freeUsed && status.creditsRemaining === 0) {
    throw new ApiError(
      402,
      'no_credits',
      'You have no clicks left. Buy a click package to keep pressing.',
    );
  }
}

// Records a milestone when the counter is exactly on one. Uses the same rule as
// milestones.js: the explicit list, then every MILESTONE_FALLBACK_STEP above its last entry.
function buildMilestoneStatement(env, now) {
  const listed = [...MILESTONES];
  const placeholders = listed.map(() => '?').join(', ');
  const maxListed = Math.max(...listed);
  return env.DB.prepare(
    `INSERT OR IGNORE INTO completed_milestones (threshold, reached_at, total_at_record)
     SELECT total, ?, total FROM global_counter
     WHERE id = 1 AND (total IN (${placeholders}) OR (total > ? AND total % ? = 0))`,
  ).bind(now, ...listed, maxListed, MILESTONE_FALLBACK_STEP);
}

export async function onRequestPost({ request, env }) {
  // 1. Identity and CSRF
  const session = await requireSession(request, env);
  requireCsrf(request, session);

  // 2. Rate limits (per IP and per user)
  await enforceIpRateLimit(env, request, 'click', RATE_LIMITS.click);
  await enforceUserRateLimit(env, 'clickUser', session.userId, RATE_LIMITS.clickUser);

  // 3. Input
  const body = await readJson(request);

  // 4. Eligibility pre-check (friendly errors, before a Turnstile token is consumed).
  //    The real enforcement is done by the database in step 6.
  const day = utcDay();
  const userId = session.userId;
  assertEligible(await loadUserStatus(env, userId, day));

  // 5. Bot check
  await requireTurnstile(env, request, body.turnstileToken);

  // 6. Atomic click
  const now = nowSeconds();
  const status = await loadUserStatus(env, userId, day);
  assertEligible(status);
  const kind = status.freeUsed ? 'paid' : 'free';

  const clickStatement =
    kind === 'free'
      ? env.DB.prepare(
          `INSERT INTO clicks (user_id, click_day, kind, credit_id, created_at)
           VALUES (?1, ?2, 'free', NULL, ?3)`,
        ).bind(userId, day, now)
      : // If no unspent credit exists, credit_id becomes NULL, the CHECK constraint
        // fails and the whole batch is rolled back.
        env.DB.prepare(
          `INSERT INTO clicks (user_id, click_day, kind, credit_id, created_at)
           VALUES (?1, ?2, 'paid',
             (SELECT c.id FROM credits c
               WHERE c.user_id = ?1
                 AND NOT EXISTS (SELECT 1 FROM clicks k WHERE k.credit_id = c.id)
               ORDER BY c.id LIMIT 1),
             ?3)`,
        ).bind(userId, day, now);

  let results;
  try {
    results = await env.DB.batch([
      clickStatement,
      env.DB.prepare('UPDATE global_counter SET total = total + 1 WHERE id = 1 RETURNING total'),
      buildMilestoneStatement(env, now),
    ]);
  } catch (err) {
    // Most likely a lost race (e.g. two simultaneous requests). Re-check to report the real reason.
    assertEligible(await loadUserStatus(env, userId, day));
    console.error('Click batch failed:', err);
    throw new ApiError(503, 'click_failed', 'The click could not be recorded. Please try again.');
  }

  const counterRows = results[1] && results[1].results;
  const total = counterRows && counterRows[0] ? counterRows[0].total : null;
  if (!Number.isInteger(total)) {
    console.error('Click batch returned no counter value.');
    throw new ApiError(500, 'internal_error', 'Something went wrong. Please try again later.');
  }

  // 7. Response with fresh data from the database
  const after = await loadUserStatus(env, userId, day);
  return json({
    ok: true,
    kind,
    total,
    nextMilestone: getNextMilestone(total),
    milestoneReached: milestoneHitAt(total),
    user: buildUserView(after, session.csrfToken),
  });
}
