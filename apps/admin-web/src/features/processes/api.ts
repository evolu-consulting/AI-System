// ADM-FR-65 · ADM-FR-66 · ADM-FR-67 · CR-056 · P-a FD2: `features/processes/api.ts` của admin-web — nơi duy nhất gọi Hub
// `/process-defs*`, `/agent-teams`, `/process-runs*` (plan-contract §3, §6). `tenantId` chỉ truyền khi là platform_admin.
import type { ProcessOutput } from "@ai/contracts/chat";
import type {
  AgentTeamListResponse,
  DecisionOption,
  ProcessDef,
  ProcessDefInput,
  ProcessDefListResponse,
  ProcessRunListResponse,
  ProcessRunSummary,
  ProcessRunUsage,
  ProcessRunView,
} from "@ai/contracts/hub-admin";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError, api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

export type EngineState = "on" | "off" | "unknown";

/** `GET /process-defs?limit=1&include_templates=false`: 200 ⇒ on; 404/403 ⇒ off; Hub chưa cấu hình ⇒ off; lỗi khác ném (⇒ unknown). */
export async function probeEngine(): Promise<EngineState> {
  const url = hubConfigured() ? hubUrl("/process-defs") : null;
  if (url === null) return "off";
  try {
    await api<unknown>(url, { query: { limit: 1, include_templates: "false" } });
    return "on";
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return "off";
    throw err;
  }
}

export const PKEYS = {
  defs: ["process", "defs"] as const,
  list: (tenantId: string | undefined, templates: boolean) =>
    ["process", "defs", "list", tenantId ?? "", templates] as const,
  def: (id: string, tenantId?: string) => ["process", "defs", "one", id, tenantId ?? ""] as const,
  teams: (tenantId?: string) => ["process", "teams", tenantId ?? ""] as const,
  runs: (key: string, tenantId?: string) => ["process", "runs", key, tenantId ?? ""] as const,
  run: (id: string, tenantId?: string) => ["process", "run", id, tenantId ?? ""] as const,
  output: (id: string, oid: string) => ["process", "output", id, oid] as const,
  usage: (id: string, tenantId?: string) => ["process", "usage", id, tenantId ?? ""] as const,
};

const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};
const enc = encodeURIComponent;
export const LIST_LIMIT = 50;
const USAGE_STALE_MS = 15_000;

// ---------- định nghĩa ----------
export function useProcessDefs(tenantId: string | undefined, templates: boolean, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: PKEYS.list(tenantId, templates),
    enabled: enabled && hubConfigured(),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ProcessDefListResponse) => last.next_cursor ?? undefined,
    queryFn: ({ pageParam }) =>
      api<ProcessDefListResponse>(url("/process-defs"), {
        query: {
          tenant_id: tenantId,
          include_templates: String(templates),
          limit: LIST_LIMIT,
          cursor: pageParam,
        },
      }),
  });
}

export const fetchDef = (id: string, tenantId?: string): Promise<ProcessDef> =>
  api<ProcessDef>(url(`/process-defs/${enc(id)}`), { query: { tenant_id: tenantId } });

export function useProcessDef(id: string | undefined, tenantId: string | undefined) {
  return useQuery({
    queryKey: PKEYS.def(id ?? "", tenantId),
    enabled: hubConfigured() && !!id,
    staleTime: 0,
    queryFn: () => fetchDef(id as string, tenantId),
  });
}

export const createDef = (body: ProcessDefInput, tenantId?: string): Promise<ProcessDef> =>
  api<ProcessDef>(url("/process-defs"), { method: "POST", query: { tenant_id: tenantId }, body });

export const updateDef = (
  id: string,
  body: ProcessDefInput & { version: number },
  tenantId?: string,
): Promise<ProcessDef> =>
  api<ProcessDef>(url(`/process-defs/${enc(id)}`), {
    method: "PUT",
    query: { tenant_id: tenantId },
    body,
  });

export const copyDef = (id: string, tenantId?: string): Promise<ProcessDef> =>
  api<ProcessDef>(url(`/process-defs/${enc(id)}/copy`), {
    method: "POST",
    query: { tenant_id: tenantId },
    body: {},
  });

export const deleteDef = (id: string, version: number, tenantId?: string): Promise<undefined> =>
  api<undefined>(url(`/process-defs/${enc(id)}`), {
    method: "DELETE",
    query: { tenant_id: tenantId, version },
  });

export const runDef = (id: string, input: string, tenantId?: string): Promise<ProcessRunSummary> =>
  api<ProcessRunSummary>(url(`/process-defs/${enc(id)}/run`), {
    method: "POST",
    query: { tenant_id: tenantId },
    body: { input },
  });

/** Làm tươi danh sách + bản đang mở sau mọi thay đổi định nghĩa. */
export function useInvalidateDefs() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: PKEYS.defs });
}

export function useAgentTeams(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: PKEYS.teams(tenantId),
    enabled: enabled && hubConfigured(),
    staleTime: 30_000,
    queryFn: () =>
      api<AgentTeamListResponse>(url("/agent-teams"), { query: { tenant_id: tenantId } }),
  });
}

// ---------- lượt chạy ----------
export function useTenantRuns(key: string | undefined, tenantId: string | undefined) {
  return useQuery({
    queryKey: PKEYS.runs(key ?? "", tenantId),
    enabled: hubConfigured() && !!key,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<ProcessRunListResponse>(url("/process-runs"), {
        query: { scope: "tenant", process_key: key, tenant_id: tenantId, limit: LIST_LIMIT },
      }),
  });
}

export function useRun(id: string, tenantId: string | undefined) {
  return useQuery({
    queryKey: PKEYS.run(id, tenantId),
    enabled: hubConfigured(),
    queryFn: () =>
      api<ProcessRunView>(url(`/process-runs/${enc(id)}`), { query: { tenant_id: tenantId } }),
  });
}

export function useRunOutput(id: string, outputId: string | null, tenantId: string | undefined) {
  return useQuery({
    queryKey: PKEYS.output(id, outputId ?? ""),
    enabled: hubConfigured() && outputId !== null,
    queryFn: () =>
      api<ProcessOutput>(url(`/process-runs/${enc(id)}/outputs/${enc(outputId ?? "")}`), {
        query: { tenant_id: tenantId },
      }),
  });
}

export function useRunUsage(id: string, tenantId: string | undefined) {
  return useQuery({
    queryKey: PKEYS.usage(id, tenantId),
    enabled: hubConfigured(),
    staleTime: USAGE_STALE_MS,
    queryFn: () =>
      api<ProcessRunUsage>(url(`/process-runs/${enc(id)}/usage`), {
        query: { tenant_id: tenantId },
      }),
  });
}

/** `decide` (3 lựa chọn) hoặc `cancel`; xong làm tươi run + danh sách lượt chạy + token. */
export function useRunAction(id: string, tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { option: DecisionOption; note: string } | "cancel") =>
      a === "cancel"
        ? api<unknown>(url(`/process-runs/${enc(id)}/cancel`), {
            method: "POST",
            query: { tenant_id: tenantId },
            body: {},
          })
        : api<unknown>(url(`/process-runs/${enc(id)}/decide`), {
            method: "POST",
            query: { tenant_id: tenantId },
            body:
              a.note.trim() === ""
                ? { option: a.option }
                : { option: a.option, note: a.note.trim() },
          }),
    onSettled: () =>
      Promise.all(
        ["run", "runs", "usage", "defs"].map((k) =>
          qc.invalidateQueries({ queryKey: ["process", k] }),
        ),
      ),
  });
}
