-- Keep catalogue prices within JavaScript's safe integer range because the
-- API transports priceMinor as a JSON number.
ALTER TABLE catalogue_entries
  ADD CONSTRAINT catalogue_entries_price_minor_safe
  CHECK (
    price_minor IS NULL
    OR price_minor <= 9007199254740991
  );
