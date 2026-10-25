ALTER TABLE business_profiles
  ADD COLUMN contact_phone_country TEXT
    CHECK (
      contact_phone_country IS NULL
      OR contact_phone_country ~ '^[A-Z]{2}$'
    ),
  ADD COLUMN currency_code TEXT
    CHECK (
      currency_code IS NULL
      OR currency_code ~ '^[A-Z]{3}$'
    );
