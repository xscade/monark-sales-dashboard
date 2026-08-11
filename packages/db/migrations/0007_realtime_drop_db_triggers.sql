-- ===========================================================================
-- Replace database-side broadcast with server-side broadcast
-- ===========================================================================
--
-- 0006 sent change signals from triggers via `realtime.send()`. On this project
-- that silently does nothing, and the way it fails is the reason it has to go:
--
--   * `realtime.messages` is a partitioned table with no partitions, and
--     `pg_cron` is not installed, so nothing creates the daily ones.
--   * Every insert therefore fails with "no partition of relation messages
--     found for row".
--   * `realtime.send()` catches that internally and downgrades it to a WARNING.
--
-- So the trigger fires, the function returns cleanly, and the notification is
-- dropped — no error anywhere. A dashboard that quietly stops announcing new
-- leads is worse than one that never claimed to, because the team stops
-- reloading. Depending on partition maintenance nobody owns would leave that
-- failure permanently one missed day away.
--
-- The application broadcasts over the Realtime REST API instead, which
-- publishes straight to subscribers and touches none of this. The channel
-- authorization from 0006 — `current_org_id()` and the `realtime.messages`
-- SELECT policy — stays: it is what makes the per-org channel private, and it
-- is evaluated on subscribe, not on insert.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS leads_realtime_notify ON leads;--> statement-breakpoint
DROP TRIGGER IF EXISTS visits_realtime_notify ON visits;--> statement-breakpoint
DROP TRIGGER IF EXISTS bookings_realtime_notify ON bookings;--> statement-breakpoint
DROP FUNCTION IF EXISTS public.notify_org_change();
