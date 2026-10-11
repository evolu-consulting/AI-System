// ADM-FR-65 · ADM-FR-66 · HUB-FR-104 · HUB-FR-109 · N1 · R-DF01…R-DF04 · luật thuần định nghĩa quy trình (plan-contract §6–§7).
// Thứ tự lỗi: INVALID (luật chéo stage) → REF_INVALID (stage lỗi đầu tiên) → INCOMPLETE (bật mà review thiếu Group).
import {
  type ProcessDefInput,
  processDefSourcePaths,
  processDefStagePaths,
} from "@ai/contracts/hub-admin";

export type DefRefs = {
  agentIds: ReadonlySet<string>;
  teamIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
  userIds: ReadonlySet<string>;
};
export type RefKind = "agent" | "team" | "group" | "user" | "source";
export type DefCheck =
  | { ok: true }
  | { ok: false; code: "PROCESS_DEF_INVALID" | "PROCESS_DEF_INCOMPLETE"; paths: string[] }
  | { ok: false; code: "PROCESS_REF_INVALID"; path: string; ref: RefKind };

type Stage = ProcessDefInput["stages"][number];
type RefMiss = { path: string; ref: RefKind };

/** Tham chiếu đầu tiên của một stage không có trong `refs` (executor → Group kiểm → người trả lời). */
function stageRefMiss(s: Stage, i: number, refs: DefRefs): RefMiss | null {
  const p = `stages.${i}`;
  if (s.executor.kind === "agent" && !refs.agentIds.has(s.executor.agent_id))
    return { path: `${p}.executor.agent_id`, ref: "agent" };
  if (s.executor.kind === "team" && !refs.teamIds.has(s.executor.team_id))
    return { path: `${p}.executor.team_id`, ref: "team" };
  if (
    s.after.kind === "review" &&
    s.after.group_id !== null &&
    !refs.groupIds.has(s.after.group_id)
  )
    return { path: `${p}.after.group_id`, ref: "group" };
  if (s.answerer.kind === "group" && !refs.groupIds.has(s.answerer.group_id))
    return { path: `${p}.answerer.group_id`, ref: "group" };
  if (s.answerer.kind === "user" && !refs.userIds.has(s.answerer.user_id))
    return { path: `${p}.answerer.user_id`, ref: "user" };
  return null;
}

/** `run_group_ids` ngoài tenant cũng là REF_INVALID (ref "group"), xét sau stage. */
function runGroupMiss(d: ProcessDefInput, refs: DefRefs): RefMiss | null {
  const i = d.run_group_ids.findIndex((g) => !refs.groupIds.has(g));
  return i < 0 ? null : { path: `run_group_ids.${i}`, ref: "group" };
}

export function validateProcessDef(d: ProcessDefInput, refs: DefRefs): DefCheck {
  const invalid = processDefStagePaths(d.stages);
  if (invalid.length)
    return { ok: false, code: "PROCESS_DEF_INVALID", paths: invalid.slice(0, 20) };
  for (const [i, s] of d.stages.entries()) {
    const miss = stageRefMiss(s, i, refs);
    if (miss) return { ok: false, code: "PROCESS_REF_INVALID", ...miss };
  }
  // PB-R06 · stage.sources[].source_key phải ∈ def.sources (path stages.<i>.sources.<j>.source_key).
  const [srcPath] = processDefSourcePaths(d);
  if (srcPath) return { ok: false, code: "PROCESS_REF_INVALID", path: srcPath, ref: "source" };
  const rg = runGroupMiss(d, refs);
  if (rg) return { ok: false, code: "PROCESS_REF_INVALID", ...rg };
  if (!d.enabled) return { ok: true };
  const incomplete = d.stages.flatMap((s, i) =>
    s.after.kind === "review" && s.after.group_id === null ? [`stages.${i}.after.group_id`] : [],
  );
  return incomplete.length
    ? { ok: false, code: "PROCESS_DEF_INCOMPLETE", paths: incomplete.slice(0, 20) }
    : { ok: true };
}

/** Bản chép từ mẫu: Group kiểm của tenant khác nhau ⇒ để trống (null), tắt tới khi admin gán đủ. Không đổi `t`. */
export function copyFromTemplate(
  t: ProcessDefInput,
  o: { key?: string; name?: string },
): ProcessDefInput {
  return {
    ...t,
    key: o.key ?? t.key,
    name: o.name ?? t.name,
    run_group_ids: [],
    enabled: false,
    stages: t.stages.map((s) => ({
      ...s,
      after: s.after.kind === "review" ? { kind: "review", group_id: null } : { kind: "auto" },
      answerer: s.answerer.kind === "starter" ? s.answerer : { kind: "starter" },
    })),
  };
}

/** Trang danh sách: khoá `(updated_at, id)` của phần tử cuối trang trước. */
export type PageKey = readonly [at: string, id: string];
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const encodeDefCursor = (k: PageKey): string =>
  Buffer.from(JSON.stringify(k), "utf8").toString("base64url");

/** Cursor hỏng/lạ ⇒ null (route trả 400). */
export function decodeDefCursor(raw: string): PageKey | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 2) return null;
    const [at, id] = v as unknown[];
    return typeof at === "string" && AT_RE.test(at) && typeof id === "string" && UUID_RE.test(id)
      ? [at, id]
      : null;
  } catch {
    return null;
  }
}

/**
 * Phạm vi của request admin: tenant_admin = tenant mình (tenant khác ⇒ NOT_FOUND, không lộ tồn tại); platform_admin có
 * `?tenant_id` = tenant đó, vắng = phạm vi mẫu (`null`); role khác ⇒ FORBIDDEN.
 */
export type DefScopeResult =
  | { ok: true; tenantId: string | null }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" };
export function defScopeOf(
  user: { role: string; tenantId: string },
  queryTenantId: string | undefined,
): DefScopeResult {
  if (user.role === "tenant_admin")
    return queryTenantId === undefined || queryTenantId === user.tenantId
      ? { ok: true, tenantId: user.tenantId }
      : { ok: false, code: "NOT_FOUND" };
  if (user.role === "platform_admin") return { ok: true, tenantId: queryTenantId ?? null };
  return { ok: false, code: "FORBIDDEN" };
}

/** Phạm vi nhìn: `tenantId` null ⇒ chỉ mẫu; có ⇒ quy trình tenant đó + mẫu. */
export type DefScope = { tenantId: string | null };
