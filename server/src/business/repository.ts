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
  contact_phone_country: string | null;
  business_address: string | null;
  timezone: string;
  opening_hours: OpeningHoursEntry[];
  currency_code: string | null;
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
  contact_phone_country,
  business_address,
  timezone,
  opening_hours,
  currency_code,
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
    contactPhoneCountry: row.contact_phone_country,
    businessAddress: row.business_address,
    timezone: row.timezone,
    openingHours: row.opening_hours,
    currencyCode: row.currency_code,
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
  workspaceId: string,
): Promise<BusinessProfile | null> {
  const result = await pool.query<ProfileRow>(
    `
      SELECT ${PROFILE_COLUMNS}
      FROM business_profiles
      WHERE workspace_id = $1
    `,
    [workspaceId],
  );

  const row = result.rows[0];
  return row ? mapProfile(row) : null;
}

export async function createBusinessProfile(
  pool: Pool,
  workspaceId: string,
  input: BusinessProfileInput,
): Promise<BusinessProfile | null> {
  const result = await pool.query<ProfileRow>(
    `
      INSERT INTO business_profiles (
        workspace_id,
        business_name,
        business_description,
        contact_email,
        contact_phone,
        contact_phone_country,
        business_address,
        timezone,
        opening_hours,
        currency_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (workspace_id) DO NOTHING
      RETURNING ${PROFILE_COLUMNS}
    `,
    [
      workspaceId,
      input.businessName,
      input.businessDescription,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.contactPhoneCountry ?? null,
      input.businessAddress ?? null,
      input.timezone,
      JSON.stringify(input.openingHours),
      input.currencyCode ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? mapProfile(row) : null;
}

export async function updateBusinessProfile(
  pool: Pool,
  workspaceId: string,
  input: BusinessProfileInput,
): Promise<BusinessProfile | null> {
  const result = await pool.query<ProfileRow>(
    `
      UPDATE business_profiles
      SET business_name = $2,
          business_description = $3,
          contact_email = $4,
          contact_phone = $5,
          contact_phone_country = $6,
          business_address = $7,
          timezone = $8,
          opening_hours = $9,
          currency_code = $10,
          updated_at = now()
      WHERE workspace_id = $1
      RETURNING ${PROFILE_COLUMNS}
    `,
    [
      workspaceId,
      input.businessName,
      input.businessDescription,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.contactPhoneCountry ?? null,
      input.businessAddress ?? null,
      input.timezone,
      JSON.stringify(input.openingHours),
      input.currencyCode ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? mapProfile(row) : null;
}

export async function listCatalogue(
  pool: Pool,
  workspaceId: string,
  activeOnly = false,
): Promise<CatalogueEntry[]> {
  const result = await pool.query<CatalogueRow>(
    `
      SELECT ${CATALOGUE_COLUMNS}
      FROM catalogue_entries
      WHERE workspace_id = $1
      ${activeOnly ? "AND is_active = true" : ""}
      ORDER BY created_at DESC, id ASC
    `,
    [workspaceId],
  );

  return result.rows.map(mapCatalogue);
}

export async function createCatalogueEntry(
  pool: Pool,
  workspaceId: string,
  input: CatalogueEntryInput,
): Promise<CatalogueEntry> {
  const result = await pool.query<CatalogueRow>(
    `
      INSERT INTO catalogue_entries (
        workspace_id,
        name,
        description,
        price_minor,
        currency_code,
        is_active,
        availability_notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${CATALOGUE_COLUMNS}
    `,
    [
      workspaceId,
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
  workspaceId: string,
  id: string,
  input: CatalogueEntryInput,
): Promise<CatalogueEntry | null> {
  const result = await pool.query<CatalogueRow>(
    `
      UPDATE catalogue_entries
      SET name = $3,
          description = $4,
          price_minor = $5,
          currency_code = $6,
          is_active = $7,
          availability_notes = $8,
          updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING ${CATALOGUE_COLUMNS}
    `,
    [
      workspaceId,
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
  workspaceId: string,
  id: string,
): Promise<CatalogueEntry | null> {
  const result = await pool.query<CatalogueRow>(
    `
      UPDATE catalogue_entries
      SET is_active = false,
          updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING ${CATALOGUE_COLUMNS}
    `,
    [workspaceId, id],
  );

  const row = result.rows[0];
  return row ? mapCatalogue(row) : null;
}

export async function listKnowledge(
  pool: Pool,
  workspaceId: string,
  activeOnly = false,
): Promise<KnowledgeEntry[]> {
  const result = await pool.query<KnowledgeRow>(
    `
      SELECT ${KNOWLEDGE_COLUMNS}
      FROM knowledge_entries
      WHERE workspace_id = $1
      ${activeOnly ? "AND is_active = true" : ""}
      ORDER BY created_at DESC, id ASC
    `,
    [workspaceId],
  );

  return result.rows.map(mapKnowledge);
}

export async function createKnowledgeEntry(
  pool: Pool,
  workspaceId: string,
  input: KnowledgeEntryInput,
): Promise<KnowledgeEntry> {
  const result = await pool.query<KnowledgeRow>(
    `
      INSERT INTO knowledge_entries (
        workspace_id,
        title,
        answer,
        entry_type,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING ${KNOWLEDGE_COLUMNS}
    `,
    [
      workspaceId,
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
  workspaceId: string,
  id: string,
  input: KnowledgeEntryInput,
): Promise<KnowledgeEntry | null> {
  const result = await pool.query<KnowledgeRow>(
    `
      UPDATE knowledge_entries
      SET title = $3,
          answer = $4,
          entry_type = $5,
          is_active = $6,
          updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING ${KNOWLEDGE_COLUMNS}
    `,
    [
      workspaceId,
      id,
      input.title,
      input.answer,
      input.entryType,
      input.isActive ?? true,
    ],
  );

  const row = result.rows[0];
  return row ? mapKnowledge(row) : null;
}

export async function deactivateKnowledgeEntry(
  pool: Pool,
  workspaceId: string,
  id: string,
): Promise<KnowledgeEntry | null> {
  const result = await pool.query<KnowledgeRow>(
    `
      UPDATE knowledge_entries
      SET is_active = false,
          updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING ${KNOWLEDGE_COLUMNS}
    `,
    [workspaceId, id],
  );

  const row = result.rows[0];
  return row ? mapKnowledge(row) : null;
}
