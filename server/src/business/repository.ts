import type { Pool } from "pg";
import {
  MAX_SAFE_PRICE_MINOR,
  type BusinessProfileInput,
  type CatalogueEntryInput,
  type KnowledgeEntryInput,
} from "./schemas.js";
import type {
  BusinessProfile,
  CatalogueEntry,
  KnowledgeEntry,
  KnowledgeEntryType,
  OpeningHoursEntry,
} from "./types.js";

type ProfileRow = {
  id: string;
  business_name: string;
  business_description: string;
  contact_email: string | null;
  contact_phone: string | null;
  business_address: string | null;
  timezone: string;
  opening_hours: OpeningHoursEntry[];
  created_at: Date;
  updated_at: Date;
};

type CatalogueRow = {
  id: string;
  name: string;
  description: string;
  price_minor: string | number | null;
  currency_code: string;
  is_active: boolean;
  availability_notes: string | null;
  created_at: Date;
  updated_at: Date;
};

type KnowledgeRow = {
  id: string;
  title: string;
  answer: string;
  entry_type: KnowledgeEntryType;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

const PROFILE_COLUMNS = `
  id,
  business_name,
  business_description,
  contact_email,
  contact_phone,
  business_address,
  timezone,
  opening_hours,
  created_at,
  updated_at
`;

const CATALOGUE_COLUMNS = `
  id,
  name,
  description,
  price_minor,
  currency_code,
  is_active,
  availability_notes,
  created_at,
  updated_at
`;

const KNOWLEDGE_COLUMNS = `
  id,
  title,
  answer,
  entry_type,
  is_active,
  created_at,
  updated_at
`;

function mapProfile(row: ProfileRow): BusinessProfile {
  return {
    id: row.id,
    businessName: row.business_name,
    businessDescription: row.business_description,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    businessAddress: row.business_address,
    timezone: row.timezone,
    openingHours: row.opening_hours,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapPriceMinor(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  const price = typeof value === "number" ? value : Number(value);

  if (
    !Number.isSafeInteger(price) ||
    price < 0 ||
    price > MAX_SAFE_PRICE_MINOR
  ) {
    throw new Error(
      "Stored catalogue price is outside the supported safe integer range.",
    );
  }

  return price;
}

function mapCatalogue(row: CatalogueRow): CatalogueEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceMinor: mapPriceMinor(row.price_minor),
    currencyCode: row.currency_code,
    isActive: row.is_active,
    availabilityNotes: row.availability_notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapKnowledge(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    title: row.title,
    answer: row.answer,
    entryType: row.entry_type,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getBusinessProfile(
  pool: Pool,
): Promise<BusinessProfile | null> {
  const result = await pool.query<ProfileRow>(
    `
      SELECT ${PROFILE_COLUMNS}
      FROM business_profiles
      WHERE singleton = true
    `,
  );

  const row = result.rows[0];
  return row ? mapProfile(row) : null;
}

export async function createBusinessProfile(
  pool: Pool,
  input: BusinessProfileInput,
): Promise<BusinessProfile | null> {
  const result = await pool.query<ProfileRow>(
    `
      INSERT INTO business_profiles (
        business_name,
        business_description,
        contact_email,
        contact_phone,
        business_address,
        timezone,
        opening_hours
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (singleton) DO NOTHING
      RETURNING ${PROFILE_COLUMNS}
    `,
    [
      input.businessName,
      input.businessDescription,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.businessAddress ?? null,
      input.timezone,
      JSON.stringify(input.openingHours),
    ],
  );

  const row = result.rows[0];
  return row ? mapProfile(row) : null;
}

export async function updateBusinessProfile(
  pool: Pool,
  input: BusinessProfileInput,
): Promise<BusinessProfile | null> {
  const result = await pool.query<ProfileRow>(
    `
      UPDATE business_profiles
      SET business_name = $1,
          business_description = $2,
          contact_email = $3,
          contact_phone = $4,
          business_address = $5,
          timezone = $6,
          opening_hours = $7,
          updated_at = now()
      WHERE singleton = true
      RETURNING ${PROFILE_COLUMNS}
    `,
    [
      input.businessName,
      input.businessDescription,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.businessAddress ?? null,
      input.timezone,
      JSON.stringify(input.openingHours),
    ],
  );

  const row = result.rows[0];
  return row ? mapProfile(row) : null;
}

export async function listCatalogue(
  pool: Pool,
  activeOnly = false,
): Promise<CatalogueEntry[]> {
  const result = await pool.query<CatalogueRow>(
    `
      SELECT ${CATALOGUE_COLUMNS}
      FROM catalogue_entries
      ${activeOnly ? "WHERE is_active = true" : ""}
      ORDER BY created_at DESC, id ASC
    `,
  );

  return result.rows.map(mapCatalogue);
}

export async function createCatalogueEntry(
  pool: Pool,
  input: CatalogueEntryInput,
): Promise<CatalogueEntry> {
  const result = await pool.query<CatalogueRow>(
    `
      INSERT INTO catalogue_entries (
        name,
        description,
        price_minor,
        currency_code,
        is_active,
        availability_notes
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${CATALOGUE_COLUMNS}
    `,
    [
      input.name,
      input.description,
      input.priceMinor ?? null,
      input.currencyCode,
      input.isActive ?? true,
      input.availabilityNotes ?? null,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Catalogue insert did not return a row.");
  }

  return mapCatalogue(row);
}

export async function updateCatalogueEntry(
  pool: Pool,
  id: string,
  input: CatalogueEntryInput,
): Promise<CatalogueEntry | null> {
  const result = await pool.query<CatalogueRow>(
    `
      UPDATE catalogue_entries
      SET name = $2,
          description = $3,
          price_minor = $4,
          currency_code = $5,
          is_active = $6,
          availability_notes = $7,
          updated_at = now()
      WHERE id = $1
      RETURNING ${CATALOGUE_COLUMNS}
    `,
    [
      id,
      input.name,
      input.description,
      input.priceMinor ?? null,
      input.currencyCode,
      input.isActive ?? true,
      input.availabilityNotes ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? mapCatalogue(row) : null;
}

export async function deactivateCatalogueEntry(
  pool: Pool,
  id: string,
): Promise<CatalogueEntry | null> {
  const result = await pool.query<CatalogueRow>(
    `
      UPDATE catalogue_entries
      SET is_active = false,
          updated_at = now()
      WHERE id = $1
      RETURNING ${CATALOGUE_COLUMNS}
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? mapCatalogue(row) : null;
}

export async function listKnowledge(
  pool: Pool,
  activeOnly = false,
): Promise<KnowledgeEntry[]> {
  const result = await pool.query<KnowledgeRow>(
    `
      SELECT ${KNOWLEDGE_COLUMNS}
      FROM knowledge_entries
      ${activeOnly ? "WHERE is_active = true" : ""}
      ORDER BY created_at DESC, id ASC
    `,
  );

  return result.rows.map(mapKnowledge);
}

export async function createKnowledgeEntry(
  pool: Pool,
  input: KnowledgeEntryInput,
): Promise<KnowledgeEntry> {
  const result = await pool.query<KnowledgeRow>(
    `
      INSERT INTO knowledge_entries (
        title,
        answer,
        entry_type,
        is_active
      )
      VALUES ($1, $2, $3, $4)
      RETURNING ${KNOWLEDGE_COLUMNS}
    `,
    [
      input.title,
      input.answer,
      input.entryType,
      input.isActive ?? true,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Knowledge entry insert did not return a row.");
  }

  return mapKnowledge(row);
}

export async function updateKnowledgeEntry(
  pool: Pool,
  id: string,
  input: KnowledgeEntryInput,
): Promise<KnowledgeEntry | null> {
  const result = await pool.query<KnowledgeRow>(
    `
      UPDATE knowledge_entries
      SET title = $2,
          answer = $3,
          entry_type = $4,
          is_active = $5,
          updated_at = now()
      WHERE id = $1
      RETURNING ${KNOWLEDGE_COLUMNS}
    `,
    [id, input.title, input.answer, input.entryType, input.isActive ?? true],
  );

  const row = result.rows[0];
  return row ? mapKnowledge(row) : null;
}

export async function deactivateKnowledgeEntry(
  pool: Pool,
  id: string,
): Promise<KnowledgeEntry | null> {
  const result = await pool.query<KnowledgeRow>(
    `
      UPDATE knowledge_entries
      SET is_active = false,
          updated_at = now()
      WHERE id = $1
      RETURNING ${KNOWLEDGE_COLUMNS}
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? mapKnowledge(row) : null;
}
