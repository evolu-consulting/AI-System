// CR-105 L5 · HTTP adapter of the process-assign port: calls hub-api (design.md §4) with a platform_admin access token.
//   1) GET /process-defs?kind=library -> find the def by `key` (same slot, must be published)
//   2) PUT /tenants/:tid/process-slots/:slot {def_id} -> 2xx ok; otherwise code from body or HTTP_<status>
import type { AssignResult, ProcessAssignPort } from "../application/ports";

export type HubAssignConfig = { url: string; accessToken: string; timeoutMs?: number };

type DefRow = { id?: unknown; key?: unknown; slot?: unknown; published_version?: unknown };

const codeOf = (body: unknown, status: number): string => {
  const b = body as { code?: unknown; error?: { code?: unknown } } | null | undefined;
  if (typeof b?.code === "string") return b.code;
  if (typeof b?.error?.code === "string") return b.error.code;
  return `HTTP_${status}`;
};

export function hubProcessAssign(cfg: HubAssignConfig): ProcessAssignPort {
  const base = cfg.url.replace(/\/+$/, "");
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
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
  return {
    async assign(tenantId, slot, processKey): Promise<AssignResult> {
      const list = await call("GET", "/process-defs?kind=library");
      if (list.status !== 200) return { ok: false, code: codeOf(list.json, list.status) };
      const j = list.json as { items?: DefRow[] } | DefRow[] | undefined;
      const rows = Array.isArray(j) ? j : (j?.items ?? []);
      const def = rows.find((r) => r.key === processKey && r.slot === slot);
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
