-- ===========================================================================
-- Return self-service check-ins to the New column
-- ===========================================================================
--
-- Until now a visitor who checked themselves in at the site was advanced
-- straight to `visited`, which skipped the columns the team actually works and
-- made the hottest lead in the building look already handled. The capture path
-- no longer does that, but the leads captured before the change are still
-- sitting in `visited` — and they are precisely the ones most likely to have
-- gone uncalled, so leaving them there would keep the original problem alive
-- for the people it already affected.
--
-- Targeted narrowly. A lead qualifies only if its LAST stage change was the
-- automatic `new -> visited` written by a public check-in, with no signed-in
-- actor behind it. Anything a human has touched since — a call logged, a
-- qualification, a move to negotiating — is real sales progress and is left
-- exactly where it is.
--
-- The move is recorded rather than erased. `lead_stage_history` is an
-- append-only ledger that cycle-time reporting reads, so this writes a
-- compensating `visited -> new` row instead of deleting the original: the
-- funnel keeps a truthful account of what happened and when, including this
-- correction. The visit itself is untouched — the person really did stand on
-- the site, and every report that counts visits reads the `visits` table, not
-- the stage.
-- ---------------------------------------------------------------------------

WITH affected AS (
  SELECT l.id, l.org_id, h.created_at AS visited_at
  FROM leads l
  JOIN LATERAL (
    SELECT s.from_stage, s.to_stage, s.changed_by, s.changed_by_user_id, s.reason, s.created_at
    FROM lead_stage_history s
    WHERE s.lead_id = l.id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) h ON true
  WHERE l.stage = 'visited'
    AND h.from_stage = 'new'
    AND h.to_stage = 'visited'
    -- Written by the public form, which has no signed-in actor. A salesperson
    -- moving somebody to Visited by hand leaves 'user' and a user id here.
    AND h.changed_by = 'api'
    AND h.changed_by_user_id IS NULL
    AND h.reason LIKE 'Checked in via %'
), logged AS (
  INSERT INTO lead_stage_history (
    org_id, lead_id, from_stage, to_stage,
    duration_in_previous_seconds, changed_by, reason
  )
  SELECT
    a.org_id, a.id, 'visited', 'new',
    GREATEST(0, EXTRACT(EPOCH FROM (now() - a.visited_at))::int),
    'system',
    'Returned to New: a self-service site check-in is not a worked lead'
  FROM affected a
  RETURNING lead_id
)
UPDATE leads
SET stage = 'new', updated_at = now()
WHERE id IN (SELECT lead_id FROM logged);
