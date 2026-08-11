-- ===========================================================================
-- Separate the callback queue from the notepad
-- ===========================================================================
--
-- Follow-ups and tasks were the same rows. Both screens read
-- `activities WHERE type = 'task'`, so a follow-up booked by moving a pipeline
-- card appeared on the Follow-ups page and again on the Tasks page — one
-- record presented as two things, with nothing to say which was authoritative.
--
-- `metadata.kind` decides which list a row belongs to from now on. Existing
-- rows are tagged from the `source` they were already written with:
--
--   pipeline_stage_change  the stage dialog and the old workflow prompts,
--                          i.e. the callback queue        -> follow_up
--   sales_ui               typed by a person               -> task
--
-- Anything else is treated as a follow-up. That direction is deliberate: an
-- untagged row stays visible in the queue that chases customers rather than
-- disappearing from the product, and the Tasks list stays strictly opt-in so it
-- cannot quietly refill with generated rows.
-- ---------------------------------------------------------------------------

UPDATE activities
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'kind',
      CASE WHEN metadata ->> 'source' = 'sales_ui' THEN 'task' ELSE 'follow_up' END
    )
WHERE type = 'task'
  AND metadata ->> 'kind' IS NULL;--> statement-breakpoint

-- Both lists filter on it on every page load.
CREATE INDEX IF NOT EXISTS activities_task_kind_idx
  ON activities ((metadata ->> 'kind'))
  WHERE type = 'task';--> statement-breakpoint

COMMENT ON INDEX activities_task_kind_idx IS
  'Splits follow-up rows from manually entered task rows; see lib/activity-kind.ts';
