// ADM-FR-65 · HUB-FR-114 · hàng DB → contract hub-admin (plan-contract §6) + lỗi khối `HUB_ADMIN_PROCESS_ERRORS` + ảnh audit.
import {
  type AgentTeam,
  HUB_ADMIN_PROCESS_ERRORS,
  type HubAdminProcessErrorCode,
  type ProcessDef,
  type ProcessDefInput,
  type ProcessDefListItem,
} from "@ai/contracts/hub-admin";
import { AppError } from "../../../lib/errors";
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
  throw defError(c.code, { paths: c.paths });
}

export function inputOf(r: DefRow): ProcessDefInput {
  return {
    key: r.key,
    name: r.name,
    description: r.description,
    input_hint: r.input_hint,
    run_group_ids: r.run_group_ids,
    stages: r.stages,
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
  };
}

export const toListItem = (r: DefListRow): ProcessDefListItem => ({
  id: r.id,
  key: r.key,
  name: r.name,
  enabled: r.enabled,
  is_template: r.tenant_id === null,
  stage_count: r.stage_count,
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
