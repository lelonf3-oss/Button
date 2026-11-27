import { PACKAGES } from '../_lib/config.js';
import { ApiError, json, utcDay } from '../_lib/http.js';
import { getNextMilestone, syncCompletedMilestones } from '../_lib/milestones.js';
import { getSession } from '../_lib/session.js';

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

export async function onRequestGet({ request, env }) {
  const [counterRow, session] = await Promise.all([
    env.DB.prepare('SELECT total FROM global_counter WHERE id = 1').first(),
    getSession(request, env),
  ]);

  if (!counterRow) {
    console.error('global_counter row is missing.');
    throw new ApiError(500, 'database_not_ready', 'The server is not configured correctly.');
  }

  const total = counterRow.total;
  const completedMilestones = await syncCompletedMilestones(env, total);

  let user = null;
  if (session) {
    const status = await loadUserStatus(env, session.userId, utcDay());
    user = buildUserView(status, session.csrfToken);
  }

  return json({
    total,
    nextMilestone: getNextMilestone(total),
    completedMilestones,
    packages: Object.values(PACKAGES).map((p) => ({
      id: p.id,
      credits: p.credits,
      amountCents: p.amountCents,
      currency: p.currency,
    })),
    user,
  });
}
