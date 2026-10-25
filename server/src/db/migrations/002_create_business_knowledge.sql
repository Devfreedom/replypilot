CREATE TABLE business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  business_name TEXT NOT NULL CHECK (char_length(btrim(business_name)) BETWEEN 1 AND 160),
  business_description TEXT NOT NULL DEFAULT '' CHECK (char_length(business_description) <= 2000),
  contact_email TEXT CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  contact_phone TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 60),
  business_address TEXT CHECK (business_address IS NULL OR char_length(business_address) <= 500),
  timezone TEXT NOT NULL DEFAULT 'Africa/Lagos' CHECK (char_length(timezone) BETWEEN 1 AND 100),
  opening_hours JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(opening_hours) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE catalogue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  price_minor BIGINT CHECK (price_minor IS NULL OR price_minor >= 0),
  currency_code TEXT NOT NULL DEFAULT 'NGN' CHECK (currency_code ~ '^[A-Z]{3}$'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  availability_notes TEXT CHECK (availability_notes IS NULL OR char_length(availability_notes) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX catalogue_entries_active_idx ON catalogue_entries (is_active, created_at DESC, id);

CREATE TABLE knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  answer TEXT NOT NULL CHECK (char_length(btrim(answer)) BETWEEN 1 AND 4000),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('faq', 'policy')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_entries_active_type_idx ON knowledge_entries (is_active, entry_type, created_at DESC, id);
