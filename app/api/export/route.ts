// app/api/export/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import * as XLSX from "xlsx";
import { OdooClient, m2oId, m2oName } from "@/lib/odoo";
import type { PropertyRecord, TenancyRecord } from "@/types/odoo";
import { COLUMN_LABELS } from "@/lib/columns";
import type { ColumnKey } from "@/lib/columns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  referenceIds: z.array(z.string().min(1)).min(1),
  columns: z.array(z.string().min(1)).min(1), // on valide par rapport à COLUMN_LABELS juste après
  salespersonId: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Colonnes autorisées
  const allowed = new Set(Object.keys(COLUMN_LABELS) as Array<ColumnKey>);
  const columns = parsed.data.columns.filter((c): c is ColumnKey => allowed.has(c as ColumnKey));
  if (columns.length === 0) {
    return NextResponse.json({ error: "Aucune colonne valide demandée" }, { status: 400 });
  }

  const { referenceIds, salespersonId } = parsed.data;
  const odoo = new OdooClient();

  // 1) property.property par reference_id (+ filtre vendeur si présent)
  const propDomain: unknown[] = [["reference_id", "in", referenceIds]];
  if (typeof salespersonId === "number") {
    propDomain.push(["sales_person_id", "=", salespersonId]);
  }

  const propFields = ["id", "reference_id", "main_property_id"]; // strict
  const properties = await odoo.searchRead<PropertyRecord>(
    "property.property",
    propDomain,
    propFields
  );
  if (properties.length === 0) {
    return NextResponse.json(
      { error: "Aucun asset trouvé pour les reference_id fournis" },
      { status: 404 }
    );
  }

  const mainPropIds = Array.from(
    new Set(
      properties
        .map((p) => m2oId(p.main_property_id) ?? p.id)
        .filter((v): v is number => typeof v === "number")
    )
  );

  // 2) property.tenancy : uniquement les champs requis (space, current_rent)
const tenancyFields: string[] = [
  "id",
  "main_property_id",
  "space",         // GLA
  "current_rent",  // Rent
];

const tenDomain: unknown[] = [["main_property_id", "in", mainPropIds]];
const tenancies = await odoo.searchRead<TenancyRecord>(
  "property.tenancy",
  tenDomain,
  tenancyFields
);

// 3) map main_property_id -> reference_id
const mainIdToRef = new Map<number, string>();
for (const p of properties) {
  const mid = m2oId(p.main_property_id) ?? p.id;
  if (typeof mid === "number") mainIdToRef.set(mid, p.reference_id);
}

// 4) construire les lignes
type Row = Record<string, string | number | null>;
const rows: Row[] = [];

for (const t of tenancies) {
  const mid = m2oId(t.main_property_id);
  const referenceId = typeof mid === "number" ? mainIdToRef.get(mid) ?? null : null;

  const gla = typeof t.space === "number" ? t.space : null;
  const rent = typeof t.current_rent === "number" ? t.current_rent : null;

  // ⚠️ pas de tenant ici (champ inconnu sur ton modèle)
  const tenantName: string | null = null;

  const line: Row = {};
  for (const col of columns) {
    switch (col) {
      case "reference_id":
        line[COLUMN_LABELS[col]] = referenceId;
        break;
      case "tenant_name":
        line[COLUMN_LABELS[col]] = tenantName;
        break;
      case "gla":
        line[COLUMN_LABELS[col]] = gla;
        break;
      case "current_rent":
        line[COLUMN_LABELS[col]] = rent;
        break;
    }
  }
  rows.push(line);
}

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Aucune tenancy trouvée pour ces assets" },
      { status: 404 }
    );
  }

  // 5) Excel
  const header = columns.map((c) => COLUMN_LABELS[c]);
  const data = rows.map((r) => header.map((h) => (r[h] ?? "")));
  const aoa = [header, ...data];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Export");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fname = `odoo_export_${now.getFullYear()}${pad(
    now.getMonth() + 1
  )}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=${fname}`,
      "Cache-Control": "no-store",
    },
  });
}
