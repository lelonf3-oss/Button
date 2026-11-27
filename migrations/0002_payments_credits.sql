-- 0002_payments_credits.sql
-- Payments, credit units and processed Stripe webhook events.

-- One row per successfully paid Stripe Checkout Session.
-- UNIQUE (stripe_session_id) guarantees a session can never grant credits twice,
-- even if Stripe sends different events for the same session.
CREATE TABLE payments (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                  INTEGER NOT NULL REFERENCES users(id),
  stripe_session_id        TEXT    NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  package_id               TEXT    NOT NULL,
  credits                  INTEGER NOT NULL CHECK (credits > 0),
  amount_cents             INTEGER NOT NULL CHECK (amount_cents > 0),
  currency                 TEXT    NOT NULL,
  created_at               INTEGER NOT NULL
);

CREATE INDEX idx_payments_user ON payments(user_id);

-- One row per purchased credit unit (a 10-click package creates 10 rows).
-- A credit is "spent" when a row in clicks references it (clicks.credit_id).
-- Remaining credits = credits without a referencing click. No balance column that could drift.
CREATE TABLE credits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  unit_no    INTEGER NOT NULL CHECK (unit_no >= 1),
  created_at INTEGER NOT NULL,
  UNIQUE (payment_id, unit_no)
);

CREATE INDEX idx_credits_user ON credits(user_id);

-- Every Stripe event ID that was processed. Used for idempotency.
CREATE TABLE processed_webhook_events (
  event_id     TEXT    PRIMARY KEY,
  event_type   TEXT    NOT NULL,
  processed_at INTEGER NOT NULL
);
