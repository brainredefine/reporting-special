// lib/odoo.ts
export interface OdooConfig {
  url: string;
  db: string;
  user: string;
  apiKey: string;
}
export type Many2One = [number, string];

interface RpcError {
  code?: number;
  message: string;
  data?: {
    name?: string;
    message?: string;
    debug?: string;   // traceback
    arguments?: unknown[];
  };
}
interface RpcEnvelope<T> {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: T;
  error?: RpcError;
}

async function postJsonRpc<T>(endpoint: string, payload: unknown): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: payload }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odoo RPC HTTP ${res.status}: ${text}`);
  }
  const data = (await res.json()) as RpcEnvelope<T>;
  if (data.error) {
    const dbg = data.error.data?.debug ? `\n${data.error.data.debug}` : "";
    throw new Error(`Odoo RPC error: ${data.error.message}${dbg}`);
  }
  if (typeof data.result === "undefined") {
    throw new Error("Odoo RPC: result undefined");
  }
  return data.result;
}

export class OdooClient {
  private cfg: OdooConfig;
  constructor(cfg?: Partial<OdooConfig>) {
    const url = cfg?.url ?? process.env.ODOO_URL ?? "";
    const db = cfg?.db ?? process.env.ODOO_DB ?? "";
    const user = cfg?.user ?? process.env.ODOO_USER ?? "";
    const apiKey = cfg?.apiKey ?? process.env.ODOO_API ?? "";
    this.cfg = { url, db, user, apiKey };
    if (!url || !db || !user || !apiKey) {
      throw new Error("Odoo env vars manquantes (ODOO_URL/DB/USER/API)");
    }
  }

  private async authenticate(): Promise<number> {
    const uid = await postJsonRpc<number>(`${this.cfg.url}/jsonrpc`, {
      service: "common",
      method: "authenticate",
      args: [this.cfg.db, this.cfg.user, this.cfg.apiKey, {}],
    });
    if (typeof uid !== "number" || Number.isNaN(uid)) {
      throw new Error("Échec d'authentification Odoo (uid invalide)");
    }
    return uid;
  }

  async executeKw<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const uid = await this.authenticate();
    return postJsonRpc<T>(`${this.cfg.url}/jsonrpc`, {
      service: "object",
      method: "execute_kw",
      args: [this.cfg.db, uid, this.cfg.apiKey, model, method, args, kwargs ?? {}],
    });
  }

  async searchRead<T>(
    model: string,
    domain: unknown[],
    fields: string[],
    limit = 2000,
    offset = 0
  ): Promise<T[]> {
    return this.executeKw<T[]>(model, "search_read", [domain], {
      fields,
      limit,
      offset,
    });
  }

  /** Récupère les champs disponibles d’un modèle (clé = nom de champ) */
  async fieldsGet(model: string, attributes?: string[]): Promise<Record<string, unknown>> {
    return this.executeKw<Record<string, unknown>>(model, "fields_get", [[], attributes ?? []]);
  }
}

/** Helpers M2O */
export function m2oId(val: number | Many2One | null | undefined): number | null {
  if (val == null) return null;
  if (Array.isArray(val)) return typeof val[0] === "number" ? val[0] : null;
  return typeof val === "number" ? val : null;
}
export function m2oName(val: number | Many2One | null | undefined): string | null {
  if (val == null) return null;
  if (Array.isArray(val)) return typeof val[1] === "string" ? val[1] : null;
  return null;
}
