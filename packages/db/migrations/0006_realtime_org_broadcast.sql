-- ===========================================================================
-- Live dashboard updates over Supabase Realtime
-- ===========================================================================
--
-- In real estate the cost of a stale screen is a callback that happens an hour
-- late, so the dashboard should not wait for somebody to press reload. What it
-- must NOT do is buy that by opening the tables up.
--
-- The obvious route — `postgres_changes` — is the wrong one here. Realtime
-- evaluates RLS for the subscriber, so it would need SELECT policies on
-- `leads`, and any policy that lets Realtime read a table also lets PostgREST
-- read it with the publishable anon key. That would hand the browser a second
-- door into the CRM which knows nothing about the module permissions the app
-- enforces: a user with no Leads access could simply query the table directly.
-- Migration 0002 closed that door deliberately and it stays closed.
--
-- Broadcast instead. The database sends a bare "something in this org changed"
-- signal on a private per-org channel; the client answers it by re-rendering
-- through Next.js, where the real auth and permission checks live. No customer
-- data ever travels over the socket, and `public` table privileges are
-- untouched — authorization happens on `realtime.messages`, in Supabase's own
-- schema.
-- ---------------------------------------------------------------------------

-- The caller's org, resolved from their Supabase identity.
--
-- SECURITY DEFINER because `authenticated` has no privileges on `users` (0002)
-- and must not be given any; the function is the single narrow exception, and
-- it returns one uuid rather than exposing a row.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.org_id
  FROM users u
  WHERE lower(u.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    AND u.is_active
  LIMIT 1
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;--> statement-breakpoint

-- Channel authorization: you may listen to your own organisation and nothing
-- else. Without this, a private channel subscription is simply refused.
DROP POLICY IF EXISTS "monark_org_broadcast_read" ON realtime.messages;--> statement-breakpoint
CREATE POLICY "monark_org_broadcast_read"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    (SELECT realtime.topic()) = 'org:' || public.current_org_id()::text
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The signal itself.
--
-- Payload is a table name, never a row. Anyone who somehow reached the channel
-- would learn that a lead changed, not who or for how much — and the client
-- still has to pass the full server-side permission check to see anything.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_org_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org uuid := COALESCE(NEW.org_id, OLD.org_id);
BEGIN
  IF org IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object('kind', TG_ARGV[0]),
        'change',
        'org:' || org::text,
        true
      );
    EXCEPTION WHEN OTHERS THEN
      -- A notification is a convenience; the booking it was announcing is not.
      -- Realtime being unreachable must never roll back the write that
      -- triggered it.
      NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- Fired on the three tables the live screens are built from. `leads` also
-- carries follow-up scheduling, so a rescheduled callback lands here too.
DROP TRIGGER IF EXISTS leads_realtime_notify ON leads;--> statement-breakpoint
CREATE TRIGGER leads_realtime_notify
  AFTER INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_org_change('leads');--> statement-breakpoint

DROP TRIGGER IF EXISTS visits_realtime_notify ON visits;--> statement-breakpoint
CREATE TRIGGER visits_realtime_notify
  AFTER INSERT OR UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION public.notify_org_change('visits');--> statement-breakpoint

DROP TRIGGER IF EXISTS bookings_realtime_notify ON bookings;--> statement-breakpoint
CREATE TRIGGER bookings_realtime_notify
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_org_change('bookings');--> statement-breakpoint

COMMENT ON FUNCTION public.notify_org_change() IS
  'Broadcasts a table-name-only change signal on the private org:<uuid> Realtime channel; never carries row data';
