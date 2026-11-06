// ADM-FR-65 · HUB-FR-114 · hàng DB → contract hub-admin (plan-contract §6) + lỗi khối `HUB_ADMIN_PROCESS_ERRORS` + ảnh audit.
import {
  type AgentTeam,
  HUB_ADMIN_PROCESS_ERRORS,
  type HubAdminProcessErrorCode,
  PROCESS_STAGES_MAX,
  type ProcessDef,
  type ProcessDefInput,
  type ProcessDefListItem,
} from "@ai/contracts/hub-admin";
import { AppError } from "../../../lib/errors";
import { slotSpecOf } from "../library/slots";
import type { DefCheck } from "./def.rules";
import type { DefListRow, DefRow } from "./defs.repo";
import type { MemberRow, TeamRow } from "./teams.repo";

const MESSAGES: Record<HubAdminProcessErrorCode, string> = {
  PROCESS_KEY_TAKEN: "Process key already taken",
  PROCESS_DEF_INVALID: "Invalid process definition",
  PROCESS_DEF_INCOMPLETE: "Process definition is incomplete",
  PROCESS_REF_INVALID: "Process definition references an unavailable item",
  TEMPLATE_READ_ONLY: "Templates are read-only",
};

export function defError(code: HubAdminProcessErrorCode, details?: unknown): AppError {
  return new AppError(code, HUB_ADMIN_PROCESS_ERRORS[code], MESSAGES[code], details);
}

/** `validateProcessDef` lỗi ⇒ ném 422 với `details` đúng dạng contract. */
export function throwIfInvalid(c: DefCheck): void {
  if (c.ok) return;
  if (c.code === "PROCESS_REF_INVALID") throw defError(c.code, { path: c.path, ref: c.ref });
  if (c.code === "PROCESS_DEF_INVALID") throw defError(c.code, { paths: c.paths, rules: c.rules });
  throw defError(c.code, { paths: c.paths });
}

export function inputOf(r: DefRow): ProcessDefInput {
  return {
    key: r.key,
    name: r.name,
    description: r.description,
    input_hint: r.input_hint,
    run_group_ids: r.run_group_ids,
    // Hàng P-a (JSONB trước CR-060) chưa có `stage.sources` ⇒ chuẩn hoá `[]` (contract default).
    stages: r.stages.map((s) => ({ ...s, sources: s.sources ?? [], must_know: s.must_know ?? [] })),
    token_budget: r.token_budget,
    enabled: r.enabled,
    sources: r.sources,
    inputs: r.inputs,
  };
}

export function toProcessDef(r: DefRow): ProcessDef {
  return {
    ...inputOf(r),
    id: r.id,
    tenant_id: r.tenant_id,
    is_template: r.tenant_id === null,
    source_template_id: r.source_template_id,
    version: r.version,
    created_at: r.created_at,
    updated_at: r.updated_at,
    ttl_days: r.ttl_days,
    // CR-122 · FlowDef: chỉ trả khi có (def cũ giữ hình response cũ).
    ...(r.trigger ? { trigger: r.trigger } : {}),
    ...(r.app ? { app: r.app } : {}),
    ...(r.slot === null
      ? companyCopyBody(r)
      : { ...libFields(r), slot: r.slot, slot_body: r.slot_body }),
  };
}

/** CR-121 c17b · bản riêng của công ty (sao từ thư viện) trả `slot_body` để Form bước dọc sửa được; def thường: không có. */
const companyCopyBody = (r: Pick<DefRow, "tenant_id" | "source_template_id" | "slot_body">) =>
  r.tenant_id !== null &&
  r.source_template_id !== null &&
  r.slot_body !== null &&
  r.slot_body !== undefined
    ? { slot_body: r.slot_body }
    : {};

/** CR-105 · trường def thư viện (vắng ở def tenant/mẫu — giữ hình response cũ). */
const libFields = (
  r: Pick<
    DefRow,
    "slot" | "published_version" | "tenant_count" | "is_default" | "has_unpublished_changes"
  >,
) => ({
  slot_label: r.slot === null ? null : (slotSpecOf(r.slot)?.label ?? null),
  published_version: r.published_version,
  is_default: r.is_default,
  has_unpublished_changes: r.has_unpublished_changes === true,
  tenant_count: Number(r.tenant_count),
});

/**
 * Cột "Số bước" của danh sách: def thư viện (có khe) chỉ đếm BƯỚC DUYỆT (khớp nhãn "Bước n" trên Sơ đồ), không đếm nút hệ thống
 * route/finalize; def thường giữ số stage. Khe không có bước nào (bất thường) ⇒ rơi về tổng stage (contract `stage_count ≥ 1`).
 */
export const listStepCount = (
  r: Pick<DefListRow, "slot" | "stage_count" | "slot_step_count">,
): number => (r.slot !== null && r.slot_step_count > 0 ? r.slot_step_count : r.stage_count);

/** CR-121 c15 · bước cho bảng Thư viện (`when` null ⇒ bỏ khoá); tối đa PROCESS_STAGES_MAX. */
export const listSteps = (r: Pick<DefListRow, "slot_steps">) =>
  (r.slot_steps ?? []).slice(0, PROCESS_STAGES_MAX).map((s) => ({
    name: s.name.slice(0, 200),
    ...(s.when === null || s.when === undefined ? {} : { when: s.when }),
  }));

export const toListItem = (r: DefListRow): ProcessDefListItem => ({
  ...(r.slot === null ? {} : { slot: r.slot, ...libFields(r), steps: listSteps(r) }),
  id: r.id,
  key: r.key,
  name: r.name,
  enabled: r.enabled,
  is_template: r.tenant_id === null,
  stage_count: listStepCount(r),
  version: r.version,
  updated_at: r.updated_at,
  active_runs: r.active_runs,
});

/** Ảnh audit gọn (không chép instruction/template — có thể dài). */
export const auditSnapshot = (r: DefRow): Record<string, unknown> => ({
  key: r.key,
  name: r.name,
  enabled: r.enabled,
  version: r.version,
  stage_count: r.stages.length,
  source_template_id: r.source_template_id,
});

export function toTeams(teams: readonly TeamRow[], members: readonly MemberRow[]): AgentTeam[] {
  return teams.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    mode: t.mode,
    members: members
      .filter((m) => m.team_id === t.id)
      .slice(0, 20)
      .map((m) => ({
        agent: { id: m.agent_id, key: m.agent_key, name: m.agent_name },
        role: m.role,
        sections: m.sections,
      })),
  }));
}
