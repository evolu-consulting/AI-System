// ADM-FR-65 · ADM-FR-66 · HUB-FR-104 · HUB-FR-109 · HUB-FR-106 (P-b2 bước) · N1 · R-DF01…R-DF04 · luật thuần định nghĩa quy trình (plan-contract §6–§7).
// Thứ tự lỗi: INVALID (luật chéo stage) → REF_INVALID (stage lỗi đầu tiên) → INCOMPLETE (bật mà review thiếu Group).
import {
  HANDOFF_SECTION,
  type ProcessDefInput,
  type ProcessDefRule,
  processDefSourcePaths,
  processDefStageIssues,
  STAGE_SECTIONS_MAX,
  STAGE_TEMPLATE_MAX,
} from "@ai/contracts/hub-admin";
import { normSection, sectionMap } from "../runs/template.rules";
import { ensureWaitStage } from "./wait-stage.rules";

export type DefRefs = {
  agentIds: ReadonlySet<string>;
  teamIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
  userIds: ReadonlySet<string>;
};
export type RefKind = "agent" | "team" | "group" | "user" | "source";
export type DefCheck =
  | { ok: true }
  | { ok: false; code: "PROCESS_DEF_INVALID"; paths: string[]; rules: ProcessDefRule[] }
  | { ok: false; code: "PROCESS_DEF_INCOMPLETE"; paths: string[] }
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
  // P-b2 D10 · `paths` + `rules` cùng chỉ số (đã cắt ≤ 20 ở contract). P-d1 · PD-R17 · `inputs` bật luật nguồn input
  // của `waitStageIssues` (WAIT_INVALID).
  const invalid = processDefStageIssues(d.stages, { inputs: d.inputs ?? [] });
  if (invalid.length)
    return {
      ok: false,
      code: "PROCESS_DEF_INVALID",
      paths: invalid.map((i) => i.path),
      rules: invalid.map((i) => i.rule),
    };
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

/** Loại nguồn cho phép ghi trên bản sao (PC-R01): `library` không có repo để sửa. */
export const AUTOFIX_SOURCE_KINDS: ReadonlySet<string> = new Set(["git_remote", "local_path"]);

/**
 * PC-R01 · path `stages.<i>.autofix.source_key` của stage tự-sửa đầu tiên có nguồn loại ngoài {git_remote, local_path}
 * (kind lạ/thiếu ⇒ coi là sai). `kinds` = key → kind của nguồn còn sống; null nếu hợp lệ.
 */
export function autofixSourceKindMiss(
  stages: readonly { autofix?: { source_key: string } | null }[],
  kinds: ReadonlyMap<string, string>,
): string | null {
  for (const [i, s] of stages.entries()) {
    if (!s.autofix) continue;
    const k = kinds.get(s.autofix.source_key);
    if (k === undefined || !AUTOFIX_SOURCE_KINDS.has(k)) return `stages.${i}.autofix.source_key`;
  }
  return null;
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

/** Hình tối thiểu của stage cho luật thêm mục (`ensureHandoff`; K1 `khStartPlan` thêm "Tóm tắt"). */
export type HandoffShape = {
  executor: { kind: string };
  output: { required_sections: string[]; template: string };
};
const HANDOFF_NORM = normSection(HANDOFF_SECTION);
const HANDOFF_TPL = `\n\n## ${HANDOFF_SECTION}\n`;
/** Heading cấp 2 `## Bàn giao` (NFC + trim + lowercase) — cùng `sectionMap` của `template.rules`. */
const hasHandoffHeading = (tpl: string): boolean => sectionMap(tpl).has(HANDOFF_NORM);

/**
 * HUB-FR-136 · R10 · G-5 · plan §4.1: stage `agent` thiếu mục "Bàn giao" ⇒ thêm CUỐI `required_sections` + `## Bàn giao`
 * cuối template. Bỏ qua `team`; đã có (trim + lowercase) ⇒ không đổi; vượt trần schema (20 mục / 20 000 ký tự) ⇒ không
 * thêm phần đó. Thuần, idempotent.
 */
export function ensureHandoff<S extends HandoffShape>(s: S): S {
  // C50 · chỉ stage `agent` có mục "Bàn giao"; `team` + `apply` (Hub tự chạy, không bàn giao) bỏ qua.
  if (s.executor.kind !== "agent") return s;
  const o = s.output;
  const hasReq = o.required_sections.some((x) => normSection(x) === HANDOFF_NORM);
  const addTpl =
    !hasHandoffHeading(o.template) && o.template.length + HANDOFF_TPL.length <= STAGE_TEMPLATE_MAX;
  const tplOk = addTpl || hasHandoffHeading(o.template);
  // Thiếu mục: chỉ thêm khi thêm được CẢ mục lẫn heading (RH-08 giữ nguyên khi sát trần).
  if (!hasReq && (o.required_sections.length >= STAGE_SECTIONS_MAX || !tplOk)) return s;
  if (hasReq && !addTpl) return s;
  return {
    ...s,
    output: {
      ...o,
      required_sections: hasReq ? o.required_sections : [...o.required_sections, HANDOFF_SECTION],
      template: addTpl ? `${o.template}${HANDOFF_TPL}` : o.template,
    },
  };
}

/** `ensureHandoff` + ép stage `wait_until` (PD-R17) cho mọi stage của def (`defs.service` create/update/copy SAU validate). */
export const withHandoff = (d: ProcessDefInput): ProcessDefInput => ({
  ...d,
  stages: d.stages.map((s) => ensureWaitStage(ensureHandoff(s))),
});

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
