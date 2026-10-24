export const KNOWLEDGE_ENTRY_TYPES = ["faq", "policy"] as const;
export type KnowledgeEntryType = (typeof KNOWLEDGE_ENTRY_TYPES)[number];

export type OpeningHoursEntry = Readonly<{
  day: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
  opensAt: string;
  closesAt: string;
}>;

export type BusinessProfile = Readonly<{
  id: string;
  businessName: string;
  businessDescription: string;
  contactEmail: string | null;
  contactPhone: string | null;
  businessAddress: string | null;
  timezone: string;
  openingHours: OpeningHoursEntry[];
  createdAt: string;
  updatedAt: string;
}>;

export type CatalogueEntry = Readonly<{
  id: string;
  name: string;
  description: string;
  priceMinor: number | null;
  currencyCode: string;
  isActive: boolean;
  availabilityNotes: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type KnowledgeEntry = Readonly<{
  id: string;
  title: string;
  answer: string;
  entryType: KnowledgeEntryType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type ReplyContext = Readonly<{
  profile: BusinessProfile | null;
  catalogue: CatalogueEntry[];
  knowledge: KnowledgeEntry[];
}>;
