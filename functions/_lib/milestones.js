// Milestone logic. The milestone list lives in config.js.

import { MILESTONES, MILESTONE_FALLBACK_STEP } from './config.js';
import { nowSeconds } from './http.js';

const SORTED = [...MILESTONES].sort((a, b) => a - b);
const LAST_LISTED = SORTED[SORTED.length - 1];
// First automatic milestone after the explicit list.
const FIRST_FALLBACK = (Math.floor(LAST_LISTED / MILESTONE_FALLBACK_STEP) + 1) * MILESTONE_FALLBACK_STEP;

// All milestone thresholds that are <= total (explicit list plus automatic ones).
export function listThresholdsUpTo(total) {
  const result = SORTED.filter((threshold) => threshold <= total);
  for (let t = FIRST_FALLBACK; t <= total; t += MILESTONE_FALLBACK_STEP) result.push(t);
  return result;
}

// The next milestone above the current total. Never null: the experiment has no end.
export function getNextMilestone(total) {
  for (const threshold of SORTED) {
    if (threshold > total) return threshold;
  }
  return (Math.floor(total / MILESTONE_FALLBACK_STEP) + 1) * MILESTONE_FALLBACK_STEP;
}

// Returns the threshold if `total` is exactly a milestone, otherwise null.
// Used right after a click to detect whether this very click completed a milestone.
export function milestoneHitAt(total) {
  return listThresholdsUpTo(total).includes(total) ? total : null;
}

// Makes sure every reached milestone is stored in the database.
// Only INSERTs missing rows, never updates or deletes existing ones.
// Returns the list of completed milestones: [{ threshold, reachedAt }].
export async function syncCompletedMilestones(env, total) {
  const { results } = await env.DB.prepare(
    'SELECT threshold, reached_at FROM completed_milestones ORDER BY threshold',
  ).all();

  const completed = results.map((row) => ({ threshold: row.threshold, reachedAt: row.reached_at }));
  const known = new Set(completed.map((m) => m.threshold));
  const missing = listThresholdsUpTo(total).filter((t) => !known.has(t));

  if (missing.length > 0) {
    const now = nowSeconds();
    const statement = env.DB.prepare(
      'INSERT OR IGNORE INTO completed_milestones (threshold, reached_at, total_at_record) VALUES (?, ?, ?)',
    );
    await env.DB.batch(missing.map((threshold) => statement.bind(threshold, now, total)));
    for (const threshold of missing) completed.push({ threshold, reachedAt: now });
    completed.sort((a, b) => a.threshold - b.threshold);
  }

  return completed;
}
