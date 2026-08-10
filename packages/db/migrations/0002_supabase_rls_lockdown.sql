-- ===========================================================================
-- Supabase RLS lockdown
-- ===========================================================================
--
-- Supabase automatically exposes a PostgREST endpoint over every table in
-- `public`, reachable with the **anon key** — a key that is designed to be
-- published in your frontend bundle.
--
-- Without Row Level Security that means anyone who views source on the Monark
-- website can read this entire CRM: every buyer's name, phone number, email,
-- budget, site-visit history, and every booking value. This is the single most
-- common way Supabase projects leak customer data, and it is silent — nothing
-- errors, nothing appears in a log, the data is simply readable.
--
-- Enabling RLS with NO policies denies everything to `anon` and
-- `authenticated`. Our server-side code is unaffected: it connects as the table
-- owner (`postgres`) via the Supabase pooler, and owners bypass RLS unless
-- FORCE ROW LEVEL SECURITY is set — which we deliberately do not set.
--
-- When the dashboard is built, add explicit per-table policies scoped by
-- org_id. Until then, deny-by-default is exactly the right posture: it is
-- always safe to add access later, and never safe to have leaked data already.
-- ===========================================================================

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      -- Drizzle's own bookkeeping lives outside `public`, but guard anyway.
      AND tablename NOT LIKE '\_\_drizzle%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.tablename);
  END LOOP;
END $$;

-- Defence in depth: even with RLS on, an accidental permissive policy added
-- later would grant access. Removing the underlying table privileges from the
-- public-facing roles means such a mistake still fails.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Apply the same default to anything created from here on, so a new table added
-- in a future migration is not silently world-readable the moment it exists.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention: expired idempotency records.
--
-- These accumulate one row per inbound lead forever and are worthless after
-- their TTL. Deleted on read-path contention rather than by a scheduled job so
-- there is one less moving part to forget about.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idempotency_cleanup_idx
  ON idempotency_keys (expires_at)
  WHERE expires_at IS NOT NULL;
