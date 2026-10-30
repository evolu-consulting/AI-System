// CR-105 L5 · HTTP adapter of the process-assign port. Calls hub `PUT /internal/tenants/:tid/process-slots/:slot
// {process_key, actor}` with the service token HUB_INTERNAL_TOKEN (same mechanism as `/internal/test-run`); hub resolves the key,
// runs the B2 group check and audits with `actor`. 2xx => ok; otherwise the hub error code (`{error:"<CODE>"}`, e.g.
// SLOT_GROUPS_MISSING / PROCESS_NOT_PUBLISHED / NOT_FOUND) or HTTP_<status>.
import type { AssignResult, ProcessAssignPort } from "../application/ports";

export type HubAssignConfig = {
  url: string;
  /** = HUB_INTERNAL_TOKEN (server-side only; never logged or put into errors). */
  internalToken: string;
  timeoutMs?: number;
  /** Test seam: replaces global fetch (int test routes to an in-process hub app). */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
};

const codeOf = (body: unknown, status: number): string => {
  const b = body as { error?: unknown; code?: unknown } | null | undefined;
  if (typeof b?.error === "string") return b.error;
  if (typeof b?.code === "string") return b.code;
  return status === 404 ? "NOT_FOUND" : `HTTP_${status}`;
};

export function hubProcessAssign(cfg: HubAssignConfig, actorId: string): ProcessAssignPort {
  const base = cfg.url.replace(/\/+$/, "");
  return {
    async assign(tenantId, slot, processKey): Promise<AssignResult> {
      const path = `/internal/tenants/${encodeURIComponent(tenantId)}/process-slots/${encodeURIComponent(slot)}`;
      const res = await (cfg.fetch ?? fetch)(`${base}${path}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${cfg.internalToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ process_key: processKey, actor: actorId }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
        redirect: "error",
      });
      if (res.status >= 200 && res.status < 300) return { ok: true };
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined;
      }
      return { ok: false, code: codeOf(json, res.status) };
    },
  };
}
