// lib/columns.ts
export type ColumnKey =
  | "reference_id"
  | "city"
  | "street_nr"
  | "zip"
  | "location_name"
  | "tenancy_name"
  | "gla"
  | "tenancy_date_start"
  | "tenancy_date_end_display"
  | "walt"
  | "total_current_rent"
  | "psm"
  | "options_summary"
  | "current_rent"
  | "current_ancillary_costs";

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  reference_id: "Asset Ref",
  city: "City",
  street_nr: "Street + Nr",
  zip: "ZIP",
  location_name: "Location",
  tenancy_name: "Tenancy name",
  gla: "GLA (space)",
  tenancy_date_start: "Date start",
  tenancy_date_end_display: "Date end (display)",
  walt: "WALT (yrs)",
  total_current_rent: "Total current rent",
  psm: "PSM (monthly)",
  options_summary: "Options (yrs x count)",
  current_rent: "Current rent",
  current_ancillary_costs: "Ancillary costs (current)",
};

// tes colonnes par défaut (tu peux garder ceci ou passer au preset Slate)
export const DEFAULT_COLUMNS: ColumnKey[] = [
  "reference_id",
  "city",
  "street_nr",
  "zip",
  "location_name",
  "tenancy_name",
  "gla",
  "tenancy_date_start",
  "tenancy_date_end_display",
  "walt",
  "total_current_rent",
  "psm",
  "options_summary",
];
