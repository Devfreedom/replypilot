-- Persists the assistant's structured draft decision so abstained drafts are
-- blocked server-side from approval or sending until edited manually.

ALTER TABLE reply_drafts
  ADD COLUMN IF NOT EXISTS decision TEXT NOT NULL DEFAULT 'reply';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reply_drafts_decision_check'
      AND conrelid = 'reply_drafts'::regclass
  ) THEN
    ALTER TABLE reply_drafts
      ADD CONSTRAINT reply_drafts_decision_check
      CHECK (decision IN ('reply', 'clarify', 'abstain'));
  END IF;
END $$;

-- Rollback (manual; this migration runner has no down migrations):
--   ALTER TABLE reply_drafts
--     DROP CONSTRAINT IF EXISTS reply_drafts_decision_check,
--     DROP COLUMN IF EXISTS decision;
