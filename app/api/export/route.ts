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

const FUND_ENUM = z.enum(["Fund III (SEREF III)", "Essential", "Fund IV", "Sunrise", "Pipeline"]);
const UUID_ENUM = z.enum(["BKO", "CFR", "FKE", "MSC"]);
const UUID_MAP: Record<z.infer<typeof UUID_ENUM>, number> = { BKO: 8, CFR: 12, FKE: 7, MSC: 9 };

const BodySchema = z.object({
  exportType: z.enum(["rent_roll", "asset_tape", "both"]),
  referenceIds: z.array(z.string().min(1)).default([]),
  columns: z.array(z.string().min(1)).default([]),
  fundName: FUND_ENUM.optional(),
  uuidCode: UUID_ENUM.optional(),
});

// helpers
function parseOdooDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function computeWALT(dateStartStr: string | null | undefined, dateEndStr: string | null | undefined): number | "M2M" {
  const start = parseOdooDate(dateStartStr);
  const end = parseOdooDate(dateEndStr);
  if (start && !end) return "M2M"; // start sans end => M2M
  if (!end) return 0;
  const today = new Date();
  const years = (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24) / 365.25;
  if (years < 0) return "M2M";
  return Math.round(years * 100) / 100;
}
function toExcelDate(val: string | null | undefined): Date | null {
  return parseOdooDate(val);
}

// formats xlsx
const fmtIntDash = '#,##0;-#,##0;"-"';
const fmt2Dash = '#,##0.00;-#,##0.00;"-"';
const fmtDate = "dd/mm/yyyy";

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { exportType, referenceIds, fundName, uuidCode } = parsed.data;

  // ordre Rent Roll (on filtrera selon les colonnes cochées)
  const RR_ORDER: ColumnKey[] = [
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
    "current_rent",
    "current_ancillary_costs",
  ];

  const allowed = new Set(Object.keys(COLUMN_LABELS) as Array<ColumnKey>);
  const requested = parsed.data.columns.filter((c): c is ColumnKey => allowed.has(c as ColumnKey));
  const rrColumns = RR_ORDER.filter((k) => requested.includes(k));

  const odoo = new OdooClient();

  // Fonds -> company_id
  let companyId: number | null = null;
  if (fundName) {
    const companies = await odoo.searchRead<{ id: number; name: string }>(
      "res.company",
      [["name", "=", fundName]],
      ["id", "name"],
      5
    );
    if (!companies.length) {
      return NextResponse.json({ error: `Fonds inconnu côté Odoo: ${fundName}` }, { status: 400 });
    }
    companyId = companies[0].id;
  }

  // Properties selon filtres
  const propDomain: unknown[] = [];
  if (referenceIds.length > 0) propDomain.push(["reference_id", "in", referenceIds]);
  if (companyId !== null) propDomain.push(["company_id", "=", companyId]);
  if (uuidCode) propDomain.push(["sales_person_id", "=", UUID_MAP[uuidCode]]);

  // On lit aussi les champs Asset Tape
const propFields = [
  "id","reference_id","main_property_id","location_id","city","street","nr","zip",
  "entity_id","construction_year","last_modernization","plot_area","no_of_parking"
];
  const properties = await odoo.searchRead<PropertyRecord>("property.property", propDomain, propFields);
  if (properties.length === 0) {
    return NextResponse.json({ error: "Aucun asset trouvé avec ces filtres" }, { status: 404 });
  }

  const mainPropIds = Array.from(new Set(
    properties.map(p => m2oId(p.main_property_id) ?? p.id)
             .filter((v): v is number => typeof v === "number")
  ));

  // Tenancies
  const tenancyFields: string[] = [
    "id","main_property_id",
    "space","current_rent","total_current_rent",
    "name","date_start","date_end_display",
    "current_ancillary_costs",
  ];
  const tenancies = await odoo.searchRead<TenancyRecord>(
    "property.tenancy", [["main_property_id","in",mainPropIds]], tenancyFields
  );

  // Options: 'property.tenancy.optioning' (tenancy_id, duration_years)
  const tenancyIds = tenancies.map(t => t.id).filter((x): x is number => typeof x === "number");
  type OptionRow = { id: number; tenancy_id: number | [number, string]; duration_years?: number | null };
  const optionRows = tenancyIds.length
    ? await odoo.searchRead<OptionRow>(
        "property.tenancy.optioning",
        [["tenancy_id","in", tenancyIds]],
        ["id","tenancy_id","duration_years"],
        5000
      )
    : [];

  // Maps utilitaires
  const optionsByTenancy = new Map<number, { count: number; duration: number }>();
  for (const o of optionRows) {
    const tid = m2oId(o.tenancy_id);
    if (tid == null) continue;
    const prev = optionsByTenancy.get(tid) ?? { count: 0, duration: 0 };
    const dur = typeof o.duration_years === "number" ? o.duration_years : prev.duration;
    optionsByTenancy.set(tid, { count: prev.count + 1, duration: dur });
  }

  const mainById = new Map<number, PropertyRecord>();
  for (const p of properties) {
    const mid = m2oId(p.main_property_id) ?? p.id;
    if (typeof mid === "number" && !mainById.has(mid)) mainById.set(mid, p);
  }

  // ====== Rent Roll rows (par tenancy) ======
  type Cell = string | number | Date | null;
  type RRRow = Record<string, Cell>;
  const rrRows: RRRow[] = [];

  if (exportType !== "asset_tape") {
    for (const t of tenancies) {
      const mid = m2oId(t.main_property_id);
      const main = typeof mid === "number" ? mainById.get(mid) : undefined;

      const glaNum = typeof t.space === "number" ? t.space : 0;
      const currentRent = typeof t.current_rent === "number" ? t.current_rent : 0;
      const totalRentNum = typeof t.total_current_rent === "number" ? t.total_current_rent : 0;
      const psmMonthly = glaNum > 0 ? (currentRent / 12) / glaNum : 0;
      const dateStart = toExcelDate(t.date_start);
      const dateEndDisp = toExcelDate(t.date_end_display);
      const waltVal = computeWALT(t.date_start, t.date_end_display);
      const ancillaryNum = typeof t.current_ancillary_costs === "number" ? t.current_ancillary_costs : 0;

      const opt = optionsByTenancy.get(t.id as number);
      const optionsSummary =
        opt && opt.count > 0 && (opt.duration ?? 0) > 0
          ? `${(Math.round((opt.duration ?? 0) * 10) / 10).toFixed(1)}yrs x ${Math.round(opt.count)}`
          : "";

      const assetRef = main?.reference_id ?? null;
      const locationName = m2oName(main?.location_id as any) ?? null;
      const city = main?.city ?? null;
      const street = main?.street ?? null;
      const nrVal = main?.nr;
      const nr = typeof nrVal === "number" ? String(nrVal) : typeof nrVal === "string" ? nrVal : null;
      const streetNr = [street ?? "", nr ?? ""].join(" ").trim() || null;
      const zip = main?.zip ?? null;

      const line: RRRow = {};
      for (const col of rrColumns) {
        switch (col) {
          case "reference_id": line[COLUMN_LABELS[col]] = assetRef; break;
          case "city": line[COLUMN_LABELS[col]] = city; break;
          case "street_nr": line[COLUMN_LABELS[col]] = streetNr; break;
          case "zip": line[COLUMN_LABELS[col]] = zip; break;
          case "location_name": line[COLUMN_LABELS[col]] = locationName; break;
          case "tenancy_name": line[COLUMN_LABELS[col]] = t.name ?? null; break;
          case "gla": line[COLUMN_LABELS[col]] = glaNum; break;
          case "tenancy_date_start": line[COLUMN_LABELS[col]] = dateStart; break;
          case "tenancy_date_end_display": line[COLUMN_LABELS[col]] = dateEndDisp; break;
          case "walt": line[COLUMN_LABELS[col]] = waltVal; break;
          case "total_current_rent": line[COLUMN_LABELS[col]] = totalRentNum; break;
          case "psm": line[COLUMN_LABELS[col]] = psmMonthly; break;
          case "options_summary": line[COLUMN_LABELS[col]] = optionsSummary; break;
          case "current_rent": line[COLUMN_LABELS[col]] = currentRent; break;
          case "current_ancillary_costs": line[COLUMN_LABELS[col]] = ancillaryNum; break;
        }
      }
      rrRows.push(line);
    }

    // tri par Asset Ref
    const lbl = COLUMN_LABELS["reference_id"];
    rrRows.sort((a, b) => String(a[lbl] ?? "").localeCompare(String(b[lbl] ?? ""), "fr"));
  }

  // ====== Asset Tape rows (par main property) ======
  type ATRow = {
    "Asset Ref": string | null;
    "City": string | null;
    "Street + Nr": string | null;
    "ZIP": string | null;
    "Entity": string | null;
    "Construction / Modernization": string;
    "Plot area": number;
    "No. of parking": number;
    "Rentable area": number;
    "WALT (yrs)": number;         // 0 affiché en "-"
    "Base rent pm": number;
  };
  const atRows: ATRow[] = [];

  if (exportType !== "rent_roll") {
    // Group tenancies par main property
    const tenByMain = new Map<number, TenancyRecord[]>();
    for (const t of tenancies) {
      const mid = m2oId(t.main_property_id);
      if (typeof mid !== "number") continue;
      const arr = tenByMain.get(mid) ?? [];
      arr.push(t);
      tenByMain.set(mid, arr);
    }

    for (const [mid, tenants] of tenByMain.entries()) {
      const main = mainById.get(mid);
      if (!main) continue;

      const assetRef = main.reference_id ?? null;
      const city = main.city ?? null;
      const street = main.street ?? null;
      const nrVal = main.nr;
      const nr = typeof nrVal === "number" ? String(nrVal) : typeof nrVal === "string" ? nrVal : null;
      const streetNr = [street ?? "", nr ?? ""].join(" ").trim() || null;
      const zip = main.zip ?? null;
      const entityName = m2oName(main.entity_id as any) ?? null;

      const cons = main.construction_year;
      const mod = main.last_modernization;
      const consStr = cons ? String(cons) : "";
      const modStr = mod ? String(mod) : "";
      const consMod =
        consStr && modStr ? `${consStr} / ${modStr}` :
        consStr || modStr;

      const plotArea = typeof main.plot_area === "number" ? main.plot_area : 0;
      const nParking = typeof main.no_of_parking === "number" ? main.no_of_parking : 0;

      // agrégations tenancies
      let rentableArea = 0;
      let baseRentPm = 0;
      let waltWeightedSum = 0;
      let weightSum = 0;

      for (const t of tenants) {
        const gla = typeof t.space === "number" ? t.space : 0;
        const totalRent = typeof t.total_current_rent === "number" ? t.total_current_rent : 0; // pm
        const walt = computeWALT(t.date_start, t.date_end_display);
        const waltNum = typeof walt === "number" ? walt : 0;

        rentableArea += gla;
        baseRentPm += totalRent;
        waltWeightedSum += waltNum * totalRent;
        weightSum += totalRent;
      }

      const waltAsset = weightSum > 0 ? Math.round((waltWeightedSum / weightSum) * 100) / 100 : 0;

      atRows.push({
        "Asset Ref": assetRef,
        "City": city,
        "Street + Nr": streetNr,
        "ZIP": zip,
        "Entity": entityName,
        "Construction / Modernization": consMod || "",
        "Plot area": plotArea,
        "No. of parking": nParking,
        "Rentable area": rentableArea,
        "WALT (yrs)": waltAsset,
        "Base rent pm": baseRentPm,
      });
    }

    // tri par Asset Ref
    atRows.sort((a, b) => String(a["Asset Ref"] ?? "").localeCompare(String(b["Asset Ref"] ?? ""), "fr"));
  }

  // ====== Construire Excel ======
  const wb = XLSX.utils.book_new();

  // utilitaire: ajoute une feuille à partir d'un AOA à B2 + formats + autofilter
  function addSheetWithFormats(
    name: string,
    header: string[],
    rows: Array<Record<string, any>>,
    numberFormats: Record<string, string>,
    dateColumns: Set<string>
  ) {
    const data = rows.map((r) => header.map((h) => (r[h] ?? "")));
    const aoa = [header, ...data];
    const ws = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(ws, aoa, { origin: "B2" });

    const start = XLSX.utils.decode_cell("B2");
    const firstDataRow = start.r + 1;
    const lastRow = firstDataRow + data.length - 1;

    // Appliquer formats (numériques et dates)
    header.forEach((h, j) => {
      const colIdx = start.c + j;
      if (dateColumns.has(h)) {
        for (let r = firstDataRow; r <= lastRow; r++) {
          const addr = XLSX.utils.encode_cell({ r, c: colIdx });
          const cell = ws[addr];
          if (!cell) continue;
          if (cell.v instanceof Date) {
            cell.t = "d";
            cell.z = fmtDate;
          } else if (typeof cell.v === "string" && cell.v) {
            const d = new Date(cell.v);
            if (!Number.isNaN(d.getTime())) {
              cell.v = d;
              cell.t = "d";
              cell.z = fmtDate;
            }
          }
        }
      } else if (numberFormats[h]) {
        const fmt = numberFormats[h];
        for (let r = firstDataRow; r <= lastRow; r++) {
          const addr = XLSX.utils.encode_cell({ r, c: colIdx });
          const cell = ws[addr];
          if (!cell) continue;
          if (typeof cell.v === "number") {
            cell.z = fmt;
          }
        }
      }
    });

    // AutoFilter
    const end = { r: start.r + aoa.length - 1, c: start.c + header.length - 1 };
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: start, e: end }) };

    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  // Rent Roll sheet
  if (exportType !== "asset_tape") {
    const rrHeader = rrColumns.map((c) => COLUMN_LABELS[c]);
    addSheetWithFormats(
      "Rent Roll",
      rrHeader,
      rrRows as any[],
      {
        [COLUMN_LABELS["gla"]]: fmtIntDash,
        [COLUMN_LABELS["current_rent"]]: fmtIntDash,
        [COLUMN_LABELS["current_ancillary_costs"]]: fmtIntDash,
        [COLUMN_LABELS["total_current_rent"]]: fmtIntDash,
        [COLUMN_LABELS["psm"]]: fmt2Dash,
        [COLUMN_LABELS["walt"]]: fmt2Dash,
      },
      new Set<string>([
        COLUMN_LABELS["tenancy_date_start"],
        COLUMN_LABELS["tenancy_date_end_display"],
      ])
    );
  }

  // Asset Tape sheet
  if (exportType !== "rent_roll") {
    const atHeader = [
      "Asset Ref",
      "City",
      "Street + Nr",
      "ZIP",
      "Entity",
      "Construction / Modernization",
      "Plot area",
      "No. of parking",
      "Rentable area",
      "WALT (yrs)",
      "Base rent pm",
    ];
    addSheetWithFormats(
      "Asset Tape",
      atHeader,
      atRows as any[],
      {
        "Plot area": fmtIntDash,
        "No. of parking": fmtIntDash,
        "Rentable area": fmtIntDash,
        "WALT (yrs)": fmt2Dash,
        "Base rent pm": fmtIntDash,
      },
      new Set<string>() // pas de colonnes date dans AT
    );
  }

  // Output
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fname = `odoo_export_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=${fname}`,
      "Cache-Control": "no-store",
    },
  });
}
