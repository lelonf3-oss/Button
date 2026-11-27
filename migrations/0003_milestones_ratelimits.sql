-- 0003_milestones_ratelimits.sql
-- Completed milestones and rate limiting.

-- Milestones that have been reached. Rows are only ever inserted
-- (INSERT OR IGNORE), never updated or deleted by the application,
-- so completed milestones can never silently change.
CREATE TABLE completed_milestones (
  threshold       INTEGER PRIMARY KEY CHECK (threshold > 0),
  reached_at      INTEGER NOT NULL,
  total_at_record INTEGER NOT NULL
);

-- Fixed-window rate limiting counters.
-- "bucket" is a string like "click:<hashed-ip>". IP addresses are stored only as salted hashes.
CREATE TABLE rate_limits (
  bucket       TEXT    NOT NULL,
  window_start INTEGER NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
) WITHOUT ROWID;

CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
