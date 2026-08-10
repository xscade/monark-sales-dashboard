-- Human-facing lead references: LD-2026-008321
--
-- Backed by a sequence rather than a row count. A count is racy under
-- concurrent inserts, and these numbers get read out loud on live sales calls,
-- so two leads sharing a reference is a real operational problem rather than a
-- cosmetic one. Sequences are also non-transactional by design, which is what
-- we want here: a rolled-back lead should burn a number, not reuse one.
CREATE SEQUENCE IF NOT EXISTS lead_reference_seq START WITH 1 INCREMENT BY 1;

CREATE SEQUENCE IF NOT EXISTS booking_reference_seq START WITH 1 INCREMENT BY 1;

-- Partial index for the outbox worker's hot path.
--
-- The worker only ever claims rows in these two states, and in a healthy system
-- they are a vanishing fraction of the table — everything else is 'delivered'.
-- A partial index keeps the claim query scanning kilobytes instead of the
-- entire delivery history, which matters once this table is millions of rows.
CREATE INDEX IF NOT EXISTS deliveries_due_partial_idx
  ON conversion_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'failed_retryable');

-- Open leads only. The pipeline board and every "my leads" view filter on this,
-- and closed leads accumulate forever while open ones stay roughly constant.
CREATE INDEX IF NOT EXISTS leads_open_idx
  ON leads (org_id, owner_user_id, stage)
  WHERE stage NOT IN ('booked', 'lost', 'disqualified');

-- Leads whose Google attribution window is closing. Drives the "act before the
-- feedback loop shuts" queue, which is the operational expression of the
-- 90-day GCLID wall.
CREATE INDEX IF NOT EXISTS touchpoints_expiring_idx
  ON lead_touchpoints (org_id, attribution_expires_at)
  WHERE attribution_expires_at IS NOT NULL;
