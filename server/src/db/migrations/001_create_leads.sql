CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  service TEXT NOT NULL
    CHECK (char_length(btrim(service)) BETWEEN 1 AND 160),
  channel TEXT NOT NULL
    CHECK (channel IN ('WhatsApp', 'Manual')),
  status TEXT NOT NULL DEFAULT 'New'
    CHECK (status IN ('New', 'Contacted', 'Quoted', 'Booked')),
  last_message TEXT NOT NULL
    CHECK (char_length(btrim(last_message)) BETWEEN 1 AND 2000),
  next_follow_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX leads_status_idx ON leads (status);

CREATE INDEX leads_next_follow_up_idx
  ON leads (next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL;

CREATE INDEX leads_created_at_idx ON leads (created_at DESC, id);
