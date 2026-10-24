export type SearchOption = Readonly<{
  value: string;
  label: string;
  description?: string;
  group?: string;
  searchText?: string;
}>;

/**
 * Diacritic-insensitive search tokenization used by the combobox and by tests
 * that verify searchable labels.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
