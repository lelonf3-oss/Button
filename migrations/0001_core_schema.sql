-- 0001_core_schema.sql
-- Core tables: users, sessions, global counter, clicks.
-- All timestamps are Unix seconds (UTC).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub    TEXT    NOT NULL UNIQUE,   -- Google's stable account ID ("sub"), never the email
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT    NOT NULL UNIQUE,      -- SHA-256 of the cookie token (raw token is never stored)
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT    NOT NULL,             -- per-session CSRF token, sent by the frontend as a header
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- The one shared global counter. Exactly one row, never reset.
CREATE TABLE global_counter (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0)
);

INSERT INTO global_counter (id, total) VALUES (1, 0);

-- One row per accepted button press.
-- The database itself enforces the click rules:
--   * UNIQUE (user_id, click_day)   -> max one click per user per UTC day (free and paid)
--   * partial unique index          -> exactly one free click per user for life
--   * UNIQUE (credit_id)            -> a paid credit unit can be spent only once
--   * CHECK on kind/credit_id       -> a paid click MUST reference a credit unit
-- Note: "credits" is created in migration 0002. SQLite allows this forward reference.
CREATE TABLE clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  click_day  TEXT    NOT NULL
             CHECK (click_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- UTC date, YYYY-MM-DD
  kind       TEXT    NOT NULL CHECK (kind IN ('free', 'paid')),
  credit_id  INTEGER UNIQUE REFERENCES credits(id),
  created_at INTEGER NOT NULL,
  CHECK (
    (kind = 'free' AND credit_id IS NULL) OR
    (kind = 'paid' AND credit_id IS NOT NULL)
  ),
  UNIQUE (user_id, click_day)
);

CREATE UNIQUE INDEX idx_clicks_one_free_per_user ON clicks(user_id) WHERE kind = 'free';
