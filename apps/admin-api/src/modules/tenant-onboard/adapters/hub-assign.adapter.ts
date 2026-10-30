// CR-105 L5 · HTTP adapter of the process-assign port: calls hub-api (design.md §4) with a platform_admin access token.
//   1) GET /process-defs?kind=library -> find the def by `key` (same slot, must be published)
//   2) PUT /tenants/:tid/process-slots/:slot {def_id} -> 2xx ok; otherwise code from body or HTTP_<status>
import type { AssignResult, ProcessAssignPort } from "../application/ports";

export type HubAssignConfig = {
  url: string;
  accessToken: string;
  timeoutMs?: number;
  /** Test seam: replaces global fetch (int test routes to an in-process hub app). */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
};

type DefRow = { id?: unknown; key?: unknown; slot?: unknown; published_version?: unknown };

const codeOf = (body: unknown, status: number): string => {
  // hub error body: { error: "<CODE>", details? } (e.g. 422 SLOT_GROUPS_MISSING / PROCESS_NOT_PUBLISHED)
  const b = body as { error?: unknown } | null | undefined;
  if (typeof b?.error === "string") return b.error;
  return `HTTP_${status}`;
};

export function hubProcessAssign(cfg: HubAssignConfig): ProcessAssignPort {
  const base = cfg.url.replace(/\/+$/, "");
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await (cfg.fetch ?? fetch)(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.accessToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
      redirect: "error",
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  };
  /** Pages `GET /process-defs?kind=library` ({items,next_cursor}) until the key is found. */
  const findDef = async (
    key: string,
    slot: string,
  ): Promise<{ def: DefRow | undefined } | { code: string }> => {
    let cursor: string | null = null;
    do {
      const q = `kind=library&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const list = await call("GET", `/process-defs?${q}`);
      if (list.status !== 200) return { code: codeOf(list.json, list.status) };
      const j = list.json as { items?: DefRow[]; next_cursor?: string | null } | undefined;
      const def = (j?.items ?? []).find((r) => r.key === key && r.slot === slot);
      if (def) return { def };
      cursor = j?.next_cursor ?? null;
    } while (cursor);
    return { def: undefined };
  };
  return {
    async assign(tenantId, slot, processKey): Promise<AssignResult> {
      const found = await findDef(processKey, slot);
      if ("code" in found) return { ok: false, code: found.code };
      const def = found.def;
      if (!def || typeof def.id !== "string") return { ok: false, code: "PROCESS_NOT_FOUND" };
      if (def.published_version == null) return { ok: false, code: "PROCESS_NOT_PUBLISHED" };
      const put = await call(
        "PUT",
        `/tenants/${encodeURIComponent(tenantId)}/process-slots/${encodeURIComponent(slot)}`,
        { def_id: def.id },
      );
      return put.status >= 200 && put.status < 300
        ? { ok: true }
        : { ok: false, code: codeOf(put.json, put.status) };
    },
  };
}
