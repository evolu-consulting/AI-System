// ADM-FR-10, ADM-FR-11, ADM-FR-13, ADM-FR-14, ADM-FR-15 · luật thuần workflows (plan M2 §4). Không import I/O.
import type { ErrorCode, InputMap, WorkflowInput } from "@ai/contracts";
import { sameJson } from "../../lib/json";

export type RuleError = { code: ErrorCode; details?: unknown };
export type UsageCommand = { id: string; name: string; enabled: boolean };
export type Usages = { commands: UsageCommand[]; agents: { id: string }[] };

/** "Chưa gắn" = không command **và** không agent (M2-R09, AC-A13). */
export const isUnattached = (c: { commandCount: number; agentCount: number }): boolean =>
  c.commandCount === 0 && c.agentCount === 0;

/** Xoá: còn bất kỳ command (kể cả tắt) hoặc agent → WORKFLOW_IN_USE (M2-R11, AC-A05). */
export function checkWorkflowDelete(u: Usages): RuleError | null {
  return u.commands.length > 0 || u.agents.length > 0
    ? {
        code: "WORKFLOW_IN_USE",
        details: { action: "delete", commands: u.commands, agents: u.agents },
      }
    : null;
}

/** Tắt: còn command đang bật hoặc agent bất kỳ → WORKFLOW_IN_USE, chỉ liệt kê command bật (M2-R11). */
export function checkWorkflowDisable(u: Usages): RuleError | null {
  const on = u.commands.filter((c) => c.enabled);
  return on.length > 0 || u.agents.length > 0
    ? { code: "WORKFLOW_IN_USE", details: { action: "disable", commands: on, agents: u.agents } }
    : null;
}

/** missing = input required không có khoá (thứ tự schema); unknown = khoá map không có trong schema (thứ tự map). */
export function inputMapGaps(
  schema: readonly WorkflowInput[],
  map: InputMap,
): { missing: string[]; unknown: string[] } {
  const names = new Set(schema.map((p) => p.name));
  return {
    missing: schema.filter((p) => p.required && !(p.name in map)).map((p) => p.name),
    unknown: Object.keys(map).filter((k) => !names.has(k)),
  };
}

export type MappedCommand = { id: string; name: string; inputMap: InputMap };
export type BrokenCommand = { id: string; name: string; missing: string[]; unknown: string[] };

/** Command (bật hay tắt) có khoảng trống với schema mới, sắp theo name (M2-R18). */
export function findBrokenCommands(
  schema: readonly WorkflowInput[],
  cmds: readonly MappedCommand[],
): BrokenCommand[] {
  return cmds
    .map((c) => ({ id: c.id, name: c.name, ...inputMapGaps(schema, c.inputMap) }))
    .filter((c) => c.missing.length > 0 || c.unknown.length > 0)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function checkSchemaChange(
  schema: readonly WorkflowInput[],
  cmds: readonly MappedCommand[],
): RuleError | null {
  const broken = findBrokenCommands(schema, cmds);
  return broken.length > 0
    ? { code: "SCHEMA_BREAKS_COMMANDS", details: { commands: broken } }
    : null;
}

export type WorkflowState = {
  name: string;
  description: string;
  appType: string;
  baseUrl: string;
  secretId: string;
  inputSchema: WorkflowInput[];
  outputField: string | null;
  enabled: boolean;
};

const KEYS: (keyof WorkflowState)[] = [
  "name",
  "description",
  "appType",
  "baseUrl",
  "secretId",
  "inputSchema",
  "outputField",
  "enabled",
];

/** Trường thực sự đổi (so sâu `inputSchema`, thứ tự tham số có nghĩa); [] → không ghi, không tăng version. */
export function changedWorkflowFields(
  cur: WorkflowState,
  next: WorkflowState,
): (keyof WorkflowState)[] {
  return KEYS.filter((k) => !sameJson(cur[k], next[k]));
}
