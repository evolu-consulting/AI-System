// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-BR-01, ADM-BR-02, ADM-BR-06, ADM-BR-10 · luật thuần commands (plan M2 §4).
// Không import I/O.
import {
  type CommandArg,
  type CommandMode,
  type ErrorCode,
  type InputMap,
  type InputMapWarning,
  TIMEOUT_DEFAULT_S,
  type WorkflowInput,
} from "@ai/contracts";
import { sameIdSet, sameJson } from "../../lib/json";
import { inputMapGaps } from "../workflows/workflows.rules";

export type RuleError = { code: ErrorCode; details?: unknown };

/** Mọi tên của command trong không gian tên chung (BR-01): tên chính rồi alias theo thứ tự. */
export const commandNames = (c: { name: string; aliases: readonly string[] }): string[] => [
  c.name,
  ...c.aliases,
];

export const defaultTimeout = (mode: CommandMode): number => TIMEOUT_DEFAULT_S[mode];

export type MapCheck = { missing: string[]; unknown: string[]; unknown_args: string[] };

/** missing/unknown = inputMapGaps; unknown_args = value của entry `arg` không có trong args (thứ tự map, không trùng). */
export function checkInputMap(
  schema: readonly WorkflowInput[],
  args: readonly CommandArg[],
  map: InputMap,
): MapCheck {
  const declared = new Set(args.map((a) => a.name));
  const unknownArgs: string[] = [];
  for (const e of Object.values(map)) {
    if (e.source === "arg" && !declared.has(e.value) && !unknownArgs.includes(e.value))
      unknownArgs.push(e.value);
  }
  return { ...inputMapGaps(schema, map), unknown_args: unknownArgs };
}

export function inputMapError(c: MapCheck): RuleError | null {
  return c.missing.length > 0 || c.unknown.length > 0 || c.unknown_args.length > 0
    ? {
        code: "INPUT_MAP_INVALID",
        details: { missing: c.missing, unknown: c.unknown, unknown_args: c.unknown_args },
      }
    : null;
}

const TEXT_SOURCES = new Set(["selection", "page_url", "page_text", "user_id", "tenant_id"]);

function typeMismatch(p: WorkflowInput, source: string): boolean {
  if (p.type === "file") return source !== "attachment";
  if (source === "attachment") return true;
  return (
    (p.type === "number" || p.type === "boolean" || p.type === "select") && TEXT_SOURCES.has(source)
  );
}

function constInvalid(p: WorkflowInput, v: string): boolean {
  if (p.type === "number") return v.trim() === "" || !Number.isFinite(Number(v));
  if (p.type === "boolean") return v !== "true" && v !== "false";
  if (p.type === "select") return !(p.options ?? []).includes(v);
  return false;
}

/** Map sai kiểu chỉ cảnh báo (RD#51), theo thứ tự schema, chỉ khoá có trong schema; `arg` không bao giờ cảnh báo. */
export function inputMapWarnings(
  schema: readonly WorkflowInput[],
  map: InputMap,
): InputMapWarning[] {
  const out: InputMapWarning[] = [];
  for (const p of schema) {
    const e = map[p.name];
    if (!e || e.source === "arg") continue;
    const base = { var: p.name, type: p.type, source: e.source };
    if (typeMismatch(p, e.source)) out.push({ ...base, reason: "type_mismatch" });
    else if (e.source === "const" && constInvalid(p, e.value))
      out.push({ ...base, reason: "const_invalid" });
  }
  return out;
}

/** BR-10: rỗng → COMMAND_NEEDS_FEATURE (không details). */
export function checkCommandFeatures(featureIds: readonly string[]): RuleError | null {
  return featureIds.length === 0 ? { code: "COMMAND_NEEDS_FEATURE" } : null;
}

/** M2-R14: command bật mà workflow tắt → WORKFLOW_DISABLED. */
export function checkCommandEnable(
  enabled: boolean,
  wf: { id: string; key: string; enabled: boolean },
): RuleError | null {
  return enabled && !wf.enabled
    ? { code: "WORKFLOW_DISABLED", details: { workflow: { id: wf.id, key: wf.key } } }
    : null;
}

export type CommandState = {
  name: string;
  aliases: string[];
  description: { vi: string; en?: string };
  workflowId: string;
  args: CommandArg[];
  inputMap: InputMap;
  output: { field: string; render: string };
  mode: CommandMode;
  timeoutS: number;
  enabled: boolean;
  featureIds: string[];
};

const KEYS: (keyof CommandState)[] = [
  "name",
  "aliases",
  "description",
  "workflowId",
  "args",
  "inputMap",
  "output",
  "mode",
  "timeoutS",
  "enabled",
  "featureIds",
];

/** featureIds so như tập; aliases so theo thứ tự; jsonb so sâu (không thứ tự khoá). */
export function changedCommandFields(
  cur: CommandState,
  next: CommandState,
): (keyof CommandState)[] {
  return KEYS.filter((k) =>
    k === "featureIds" ? !sameIdSet(cur.featureIds, next.featureIds) : !sameJson(cur[k], next[k]),
  );
}
