-- Existing single-business development data is assigned to an explicit legacy
-- workspace. The workspace is intentionally not attached to any account here:
-- a guarded CLI bootstrap links it to a chosen existing account.
INSERT INTO workspaces (id, name)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Legacy development workspace'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE leads ADD COLUMN workspace_id UUID;
ALTER TABLE business_profiles ADD COLUMN workspace_id UUID;
ALTER TABLE catalogue_entries ADD COLUMN workspace_id UUID;
ALTER TABLE knowledge_entries ADD COLUMN workspace_id UUID;
ALTER TABLE reply_drafts ADD COLUMN workspace_id UUID;

UPDATE leads
SET workspace_id = '00000000-0000-4000-8000-000000000001'
WHERE workspace_id IS NULL;

UPDATE business_profiles
SET workspace_id = '00000000-0000-4000-8000-000000000001'
WHERE workspace_id IS NULL;

UPDATE catalogue_entries
SET workspace_id = '00000000-0000-4000-8000-000000000001'
WHERE workspace_id IS NULL;

UPDATE knowledge_entries
SET workspace_id = '00000000-0000-4000-8000-000000000001'
WHERE workspace_id IS NULL;

UPDATE reply_drafts AS draft
SET workspace_id = lead.workspace_id
FROM leads AS lead
WHERE draft.lead_id = lead.id
  AND draft.workspace_id IS NULL;

ALTER TABLE leads ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE business_profiles ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE catalogue_entries ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE knowledge_entries ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE reply_drafts ALTER COLUMN workspace_id SET NOT NULL;

-- The old singleton column prevented any second business workspace. Profile
-- existence is now unique per workspace instead.
ALTER TABLE business_profiles DROP COLUMN singleton;

ALTER TABLE business_profiles
  ADD CONSTRAINT business_profiles_workspace_id_key UNIQUE (workspace_id);

-- This redundant unique key is the parent target for the composite foreign key
-- that prevents a reply draft from referencing a lead in another workspace.
ALTER TABLE leads
  ADD CONSTRAINT leads_id_workspace_id_key UNIQUE (id, workspace_id);

ALTER TABLE leads
  ADD CONSTRAINT leads_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE business_profiles
  ADD CONSTRAINT business_profiles_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE catalogue_entries
  ADD CONSTRAINT catalogue_entries_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE knowledge_entries
  ADD CONSTRAINT knowledge_entries_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE reply_drafts
  ADD CONSTRAINT reply_drafts_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE reply_drafts
  ADD CONSTRAINT reply_drafts_lead_workspace_fkey
  FOREIGN KEY (lead_id, workspace_id)
  REFERENCES leads(id, workspace_id) ON DELETE CASCADE;

CREATE INDEX leads_workspace_created_at_idx
  ON leads (workspace_id, created_at DESC, id);
CREATE INDEX business_profiles_workspace_id_idx
  ON business_profiles (workspace_id);
CREATE INDEX catalogue_entries_workspace_active_idx
  ON catalogue_entries (workspace_id, is_active, created_at DESC, id);
CREATE INDEX knowledge_entries_workspace_active_idx
  ON knowledge_entries (workspace_id, is_active, entry_type, created_at DESC, id);
CREATE INDEX reply_drafts_workspace_lead_created_idx
  ON reply_drafts (workspace_id, lead_id, created_at DESC, id);
