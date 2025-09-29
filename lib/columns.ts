export const COLUMN_KEYS = [
"reference_id",
"tenant_name",
"gla",
"current_rent",
"lease_start",
"lease_end",
] as const;


export type ColumnKey = typeof COLUMN_KEYS[number];


export const COLUMN_LABELS: Record<ColumnKey, string> = {
reference_id: "Asset Ref",
tenant_name: "Tenant",
gla: "GLA (space)",
current_rent: "Current rent",
lease_start: "Lease start",
lease_end: "Lease end",
};


export const DEFAULT_COLUMNS: ColumnKey[] = [
"reference_id",
"tenant_name",
"gla",
"current_rent",
];