// app/page.tsx
"use client";
import { useMemo, useState } from "react";
import { COLUMN_LABELS, DEFAULT_COLUMNS } from "@/lib/columns";
import type { ColumnKey } from "@/lib/columns";

type ExportType = "rent_roll" | "asset_tape" | "both";

const FUND_OPTIONS = [
  { label: "— Aucun —", value: "" },
  { label: "Fund III (SEREF III)", value: "Fund III (SEREF III)" },
  { label: "Essential", value: "Essential" },
  { label: "Fund IV", value: "Fund IV" },
  { label: "Sunrise", value: "Sunrise" },
  { label: "Pipeline", value: "Pipeline" },
] as const;

const UUID_OPTIONS = [
  { label: "— Aucun —", value: "" },
  { label: "BKO", value: "BKO" }, // 8
  { label: "CFR", value: "CFR" }, // 12
  { label: "FKE", value: "FKE" }, // 7
  { label: "MSC", value: "MSC" }, // 9
] as const;

const SLATE_PRESET: ColumnKey[] = [
  "reference_id",
  "city",
  "street_nr",
  "zip",
  "tenancy_name",
  "gla",
  "tenancy_date_start",
  "tenancy_date_end_display",
  "walt",
  "total_current_rent",
  "psm",
  "options_summary",
];

export default function Page() {
  const [exportType, setExportType] = useState<ExportType>("rent_roll");
  const [refsInput, setRefsInput] = useState<string>("");
  const [fundName, setFundName] = useState<string>("");
  const [uuidCode, setUuidCode] = useState<string>("");
  const [selected, setSelected] = useState<ColumnKey[]>(DEFAULT_COLUMNS as ColumnKey[]);
  const [slateChecked, setSlateChecked] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const allColumns = useMemo(
    () => Object.entries(COLUMN_LABELS) as Array<[ColumnKey, string]>,
    []
  );
  const allowed = useMemo(
    () => new Set(Object.keys(COLUMN_LABELS) as Array<ColumnKey>),
    []
  );

  function toggle(col: ColumnKey) {
    setSelected((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
    setSlateChecked(false);
  }
  function toggleAll(on: boolean) {
    setSelected(on ? (Object.keys(COLUMN_LABELS) as ColumnKey[]) : []);
    setSlateChecked(false);
  }
  function toggleSlate(on: boolean) {
    setSlateChecked(on);
    if (on) setSelected(SLATE_PRESET);
  }

  async function onExport() {
    setError("");

    const cleanedUnique = Array.from(
      new Set(
        refsInput
          .split(/[\n,;,\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      )
    );
    const cols = selected.filter((c) => allowed.has(c));

    if ((exportType === "rent_roll" || exportType === "both") && cols.length === 0) {
      setError("Sélectionne au moins une colonne (ou choisis 'Asset Tape' seul).");
      return;
    }

    setDownloading(true);
    try {
      const body = {
        exportType,
        referenceIds: cleanedUnique,
        columns: cols,            // ignoré si asset_tape seul
        fundName: fundName || undefined,
        uuidCode: uuidCode || undefined,
      };
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "odoo_export.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  const rrDisabled = exportType === "asset_tape";

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <HeroBackground />

      <div className="relative z-10 mx-auto max-w-4xl px-6 py-16">
        <header className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Export Odoo → Excel
          </h1>
          <p className="mt-3 text-zinc-400">
            Choisis tes filtres (fonds/uuid/asset) et le type d’export.
          </p>
        </header>

        <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-2xl space-y-8">

          {/* Type d’export */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <input
                type="radio"
                name="exportType"
                checked={exportType === "rent_roll"}
                onChange={() => setExportType("rent_roll")}
              />
              Rent Roll
            </label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <input
                type="radio"
                name="exportType"
                checked={exportType === "asset_tape"}
                onChange={() => setExportType("asset_tape")}
              />
              Asset Tape
            </label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <input
                type="radio"
                name="exportType"
                checked={exportType === "both"}
                onChange={() => setExportType("both")}
              />
              Les deux
            </label>
          </div>

          {/* Filtres */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-200 mb-2">Fonds (company)</label>
              <select
                value={fundName}
                onChange={(e) => setFundName(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-white outline-none placeholder:text-zinc-300 focus:border-white/25"
              >
                {FUND_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-zinc-200 mb-2">UUID</label>
              <select
                value={uuidCode}
                onChange={(e) => setUuidCode(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-white outline-none placeholder:text-zinc-300 focus:border-white/25"
              >
                {UUID_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-xs text-zinc-400 mt-1">Mapping: BKO→8, CFR→12, FKE→7, MSC→9</p>
            </div>
          </div>

          {/* Assets (optionnel) */}
          <div>
            <label className="block text-sm text-zinc-200 mb-2">
              Assets reference_id (optionnels — séparés par virgule, espace ou retour)
            </label>
            <textarea
              value={refsInput}
              onChange={(e) => setRefsInput(e.target.value)}
              rows={4}
              className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-white outline-none placeholder:text-zinc-300 focus:border-white/25"
              placeholder="AA1, AA2, AB10 …"
            />
            <p className="text-xs text-zinc-400 mt-1">
              Si vide : on utilisera le filtre Fonds / UUID, sinon tous les assets.
            </p>
          </div>

          {/* Colonnes Rent Roll */}
          <div className={rrDisabled ? "opacity-50 pointer-events-none select-none" : ""}>
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleAll(true)}
                    className="rounded border border-white/15 bg-white/10 px-2 py-1 text-xs hover:border-white/25"
                  >
                    Tout cocher
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAll(false)}
                    className="rounded border border-white/15 bg-white/10 px-2 py-1 text-xs hover:border-white/25"
                  >
                    Tout décocher
                  </button>
                </div>

                <label className="inline-flex items-center gap-2 text-sm sm:ml-auto">
                  <input
                    type="checkbox"
                    checked={slateChecked}
                    onChange={(e) => toggleSlate(e.target.checked)}
                  />
                  Slate (preset)
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {allColumns.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(key)}
                      onChange={() => toggle(key)}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onExport}
              disabled={downloading}
              className="rounded-xl bg-white/90 text-black px-4 py-3 font-medium shadow-lg hover:bg-white disabled:opacity-50"
            >
              {downloading ? "Génération…" : "Exporter en Excel"}
            </button>
          </div>

          {error && <p className="text-sm text-red-400 whitespace-pre-wrap">{error}</p>}
        </section>
      </div>
    </main>
  );
}

function HeroBackground() {
  return (
    <>
      <div className="fixed inset-0 z-0 bg-gradient-to-tr from-[#0b0f2e] via-[#081436] to-[#021b3a]" />
      <div className="fixed inset-0 z-0 bg-[radial-gradient(80rem_40rem_at_10%_80%,rgba(255,153,51,0.15),transparent_60%)]" />
      <div className="fixed inset-0 z-0 bg-[radial-gradient(80rem_40rem_at_90%_10%,rgba(64,149,255,0.2),transparent_60%)]" />
      <div className="fixed inset-0 z-0 bg-gradient-to-b from-black/10 via-black/40 to-black/70" />
    </>
  );
}
