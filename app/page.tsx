// app/page.tsx
"use client";
import { useMemo, useState } from "react";
import { COLUMN_LABELS, DEFAULT_COLUMNS } from "@/lib/columns";
import type { ColumnKey } from "@/lib/columns";

export default function Page() {
  const [refsInput, setRefsInput] = useState<string>("");
  const [salesId, setSalesId] = useState<string>("");
  const [selected, setSelected] = useState<ColumnKey[]>(
    DEFAULT_COLUMNS as ColumnKey[]
  );
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
  }
  function toggleAll(on: boolean) {
    setSelected(on ? (Object.keys(COLUMN_LABELS) as ColumnKey[]) : []);
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

    if (cleanedUnique.length === 0) {
      setError("Ajoute au moins un reference_id");
      return;
    }
    if (cols.length === 0) {
      setError("Sélectionne au moins une colonne");
      return;
    }

    setDownloading(true);
    try {
      const body = {
        referenceIds: cleanedUnique,
        columns: cols,
        salespersonId: salesId ? Number(salesId) : undefined,
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

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Export Odoo → Excel</h1>

      <section className="space-y-2">
        <label className="block text-sm font-medium">
          Assets reference_id (séparés par virgule, espace ou retour)
        </label>
        <textarea
          value={refsInput}
          onChange={(e) => setRefsInput(e.target.value)}
          rows={4}
          className="w-full rounded-xl border p-3"
          placeholder="AA1, AA2, AB10 …"
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleAll(true)}
            className="rounded border px-2 py-1 text-xs"
          >
            Tout cocher
          </button>
          <button
            type="button"
            onClick={() => toggleAll(false)}
            className="rounded border px-2 py-1 text-xs"
          >
            Tout décocher
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {allColumns.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(key)}
                onChange={() => toggle(key)}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium">
            sales_person_id (optionnel)
          </label>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={salesId}
            onChange={(e) =>
              setSalesId(e.target.value.replace(/[^0-9]/g, ""))
            }
            className="w-full rounded-xl border p-3"
            placeholder="ex: 6"
          />
        </div>
        <button
          onClick={onExport}
          disabled={downloading}
          className="rounded-xl bg-black text-white px-4 py-3 disabled:opacity-50"
        >
          {downloading ? "Génération…" : "Exporter en Excel"}
        </button>
      </section>

      {error && (
        <p className="text-sm text-red-600 whitespace-pre-wrap">{error}</p>
      )}
    </main>
  );
}
