import { MILESTONES, MILESTONE_FALLBACK_STEP, RATE_LIMITS } from '../_lib/config.js';
import { ApiError, json, nowSeconds, readJson, utcDay } from '../_lib/http.js';
import { getNextMilestone, milestoneHitAt } from '../_lib/milestones.js';
import { enforceIpRateLimit, enforceUserRateLimit } from '../_lib/rate-limit.js';
import { requireCsrf, requireSession } from '../_lib/session.js';
import { requireTurnstile } from '../_lib/turnstile.js';

function nextUtcMidnightIso(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}

async function loadUserStatus(env, userId, day) {
  const dayStart = Math.floor(Date.parse(day + 'T00:00:00Z') / 1000);
  const dayEnd = dayStart + 86400;

  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM clicks WHERE user_id = ?1 AND kind = 'free') AS free_used,
       (SELECT COUNT(*) FROM clicks WHERE user_id = ?1 AND click_day = ?2) AS clicked_today,
       (SELECT COUNT(*) FROM payments WHERE user_id = ?1 AND created_at >= ?3 AND created_at < ?4) AS bought_today,
       (SELECT COUNT(*) FROM credits c
          WHERE c.user_id = ?1
            AND NOT EXISTS (SELECT 1 FROM clicks k WHERE k.credit_id = c.id)) AS credits_remaining`,
  )
    .bind(userId, day, dayStart, dayEnd)
    .first();

  return {
    freeUsed: row.free_used > 0,
    clickedToday: row.clicked_today > 0,
    boughtToday: row.bought_today > 0,
    creditsRemaining: row.credits_remaining,
  };
}

function buildUserView(status, csrfToken) {
  return {
    csrfToken,
    freeClickAvailable: !status.freeUsed,
    creditsRemaining: status.creditsRemaining,
    clickedToday: status.clickedToday,
    boughtToday: status.boughtToday,
    canClick: !status.clickedToday && (!status.freeUsed || status.creditsRemaining > 0),
    nextClickAt: nextUtcMidnightIso(),
  };
}

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
  const session = await requireSession(request, env);
  requireCsrf(request, session);
  await enforceIpRateLimit(env, request, 'click', RATE_LIMITS.click);
  await enforceUserRateLimit(env, 'clickUser', session.userId, RATE_LIMITS.clickUser);

  const body = await readJson(request);

  const day = utcDay();
  const userId = session.userId;
  assertEligible(await loadUserStatus(env, userId, day));

  await requireTurnstile(env, request, body.turnstileToken);

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
      : env.DB.prepare(
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
