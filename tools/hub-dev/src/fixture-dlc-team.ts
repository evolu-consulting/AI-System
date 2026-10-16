// DLC-R13 · đội agent của AI SDLC cho tenant `evolu`: mỗi vai trò AI của engine DLC (`GET <HUB_DLC_URL>/api/catalog`,
// `line/catalog.py`) thành một agent `dlc-<role>` runtime `python`, loại `dlc-role` (Runtime ghi manifest), không profile,
// `runtime_options = {role, step, kind, model, supervisor: "dlc"}`; bật cho công ty evolu (entitlement), không cấp quyền
// chat (agent `python` không có trong menu `@` — engine DLC chạy chúng bên trong run). Vai trò `supervisor` của engine là
// agent `dlc` (AI SDLC). Engine không tới được → bỏ qua (trả số agent = 0). Idempotent: agent đã có thì chỉ cập nhật
// `runtime_options.model` (model engine đang dùng), không đụng phần khác đã sửa ở Studio.
import type postgres from "postgres";

export const DLC_ROLE_TYPE = "dlc-role";
export const DLC_SUPERVISOR = "dlc";

export type DlcCatalogAgent = {
  role: string;
  kind: string;
  step: string;
  does: string;
  model: string;
};

const ROLE_RE = /^[a-z][a-z0-9_]{1,45}$/;

/** Danh sách vai trò từ engine; lỗi / sai dạng → []. */
export async function fetchCatalogAgents(url: string | undefined): Promise<DlcCatalogAgent[]> {
  if (!url) return [];
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/catalog`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { agents?: unknown };
    if (!Array.isArray(body.agents)) return [];
    return body.agents.filter(
      (a): a is DlcCatalogAgent =>
        !!a && typeof a === "object" && ROLE_RE.test(String((a as DlcCatalogAgent).role)),
    );
  } catch {
    return [];
  }
}

export const roleAgentKey = (role: string): string => `dlc-${role.replaceAll("_", "-")}`;

/** Tên hiển thị: `reader_a` → "DLC Reader A". */
export function roleName(role: string): string {
  const words = role
    .split("_")
    .map((w) => (w.length <= 1 ? w.toUpperCase() : w[0]?.toUpperCase() + w.slice(1)));
  return `DLC ${words.join(" ")}`;
}

function rowOf(a: DlcCatalogAgent) {
  const desc = `${a.does}. Bước: ${a.step}. Do engine AI SDLC chạy trong run, giám sát bởi @${DLC_SUPERVISOR}.`;
  return {
    key: roleAgentKey(a.role),
    name: { vi: roleName(a.role), en: roleName(a.role) },
    description: desc.slice(0, 400),
    runtime: "python",
    agent_type_key: DLC_ROLE_TYPE,
    runtime_options: {
      role: a.role,
      step: a.step,
      kind: a.kind === "agentic" ? "agentic" : "complete",
      model: a.model,
      supervisor: DLC_SUPERVISOR,
    },
  };
}

/** Ghi đội agent trong transaction của fixture. Trả số vai trò đã đồng bộ. */
export async function ensureDlcTeam(
  tx: postgres.TransactionSql,
  tid: string,
  agents: readonly DlcCatalogAgent[],
): Promise<number> {
  const team = agents.filter((a) => a.role !== "supervisor").map(rowOf);
  for (const r of team) {
    await tx`insert into hub.agents (key, name, description, runtime, agent_type_key, runtime_options, timeout_s)
      values (${r.key}, ${tx.json(r.name)}, ${r.description}, ${r.runtime}, ${r.agent_type_key},
        ${tx.json(r.runtime_options)}, 600)
      on conflict (key) do update set runtime_options = jsonb_set(hub.agents.runtime_options, '{model}',
        to_jsonb(${r.runtime_options.model}::text)) where hub.agents.agent_type_key = ${DLC_ROLE_TYPE}`;
  }
  if (team.length === 0) return 0;
  const ids = await tx<
    { id: string }[]
  >`select id from hub.agents where key in ${tx(team.map((r) => r.key))}`;
  await tx`insert into hub.agent_entitlements ${tx(ids.map((a) => ({ agent_id: a.id, tenant_id: tid })))}
    on conflict do nothing`;
  return team.length;
}

/** DLC-R14 · workflow DLC mặc định (một mỗi process; Evolu Control › Workflow Process sửa được). */
export const DLC_DEFAULT_WORKFLOWS = [
  {
    key: "dlc-new-system",
    name: "AI SDLC · New System",
    description: "Xây ứng dụng mới từ spec Markdown (mỗi tính năng một mục ## F<n>).",
    process: "new-system",
  },
  {
    key: "dlc-enhancement",
    name: "AI SDLC · Enhancement",
    description: "Thêm hoặc đổi tính năng của dự án đã build; engine tự định cỡ (lane).",
    process: "enhancement",
  },
  {
    key: "dlc-bug-fix",
    name: "AI SDLC · Bug Fix",
    description: "Sửa một lỗi từ mô tả: bước tái hiện, kết quả mong đợi, kết quả thực tế.",
    process: "bug-fix",
  },
] as const;

export async function ensureDlcWorkflows(tx: postgres.TransactionSql): Promise<number> {
  const rows = await tx`insert into hub.dlc_workflows ${tx(
    DLC_DEFAULT_WORKFLOWS.map((w) => ({ ...w, is_default: true })),
  )} on conflict do nothing returning 1`;
  return rows.length;
}
