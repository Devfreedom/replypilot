CREATE TABLE reply_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  intent TEXT NOT NULL
    CHECK (intent IN ('availability', 'pricing', 'service-details', 'booking', 'general-enquiry')),
  summary TEXT NOT NULL
    CHECK (char_length(btrim(summary)) BETWEEN 1 AND 500),
  missing_information JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(missing_information) = 'array'),
  draft_reply TEXT NOT NULL
    CHECK (char_length(btrim(draft_reply)) BETWEEN 1 AND 2000),
  provider TEXT NOT NULL
    CHECK (char_length(btrim(provider)) BETWEEN 1 AND 50),
  is_demo BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved')),
  sources JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(sources) = 'array'),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'approved' AND approved_at IS NOT NULL)
    OR (status = 'draft' AND approved_at IS NULL)
  )
);

CREATE INDEX reply_drafts_lead_created_idx
  ON reply_drafts (lead_id, created_at DESC, id);
