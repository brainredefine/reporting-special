// types/odoo.ts
import type { Many2One } from "@/lib/odoo";

export interface PropertyRecord {
  id: number;
  reference_id: string;
  main_property_id?: Many2One | number | null;
  sales_person_id?: Many2One | number | null;

  // Asset Tape fields
  entity_id?: Many2One | number | null;      // -> name
  construction_year?: number | null;
  last_modernization?: number | null;
  plot_area?: number | null;
  no_of_parking?: number | null;

  // adresse déjà utilisée
  location_id?: Many2One | number | null;
  city?: string | null;
  street?: string | null;
  nr?: string | number | null;
  zip?: string | null;
}

export interface TenancyRecord {
  id: number;
  main_property_id?: Many2One | number | null;
  name?: string | null;

  space?: number | null;
  gla?: number | null;
  leased_area?: number | null;
  area?: number | null;

  current_rent?: number | null;
  rent?: number | null;
  actual_rent?: number | null;

  total_current_rent?: number | null;
  current_ancillary_costs?: number | null;

  date_start?: string | null;
  lease_start?: string | null;
  start_date?: string | null;

  date_end_display?: string | null;
  lease_end?: string | null;
  end_date?: string | null;
}
