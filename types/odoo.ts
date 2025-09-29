import type { Many2One } from "@/lib/odoo";


export interface PropertyRecord {
id: number;
reference_id: string;
main_property_id?: Many2One | number | null;
sales_person_id?: Many2One | number | null;
}


export interface TenancyRecord {
id: number;
main_property_id?: Many2One | number | null;
tenant_id?: Many2One | number | null;
space?: number | null;
gla?: number | null;
leased_area?: number | null;
area?: number | null;
current_rent?: number | null;
rent?: number | null;
actual_rent?: number | null;
lease_start?: string | null;
start_date?: string | null;
date_start?: string | null;
lease_end?: string | null;
end_date?: string | null;
date_end?: string | null;
}