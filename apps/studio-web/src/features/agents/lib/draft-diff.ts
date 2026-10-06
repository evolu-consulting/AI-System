// HUB-FR-69 · H4a-R09 · "Xem khác biệt" của ConflictDialog: chỉ các trường nháp của bạn khác bản mới nhất (tối đa 8 dòng).
import type { DiffRow } from "#/components/shared/conflict/types";
import type { AgentDraft } from "./draft";

type Key = Exclude<keyof AgentDraft, "bashAck" | "rawOptions" | "runtime" | "maxTurns" | "cwdMode">;
/** Thứ tự + khoá i18n nhãn (`editor.field.*`); `workflowIds` dùng nhãn bước 3. */
const FIELDS: [Key, string][] = [
  ["key", "editor.field.key"],
  ["nameVi", "editor.field.nameVi"],
  ["nameEn", "editor.field.nameEn"],
  ["description", "editor.field.description"],
  ["profileId", "editor.field.profile"],
  ["cli", "editor.field.cli"],
  ["tools", "editor.field.tools"],
  ["mcp", "editor.field.mcp"],
  ["timeout", "editor.field.timeout"],
  ["tokenBudget", "editor.field.tokenBudget"],
  ["prompt", "editor.field.prompt"],
  ["enabled", "editor.field.enabled"],
  ["workflowIds", "editor.step.3"],
  ["agentTypeKey", "editor.field.agentType"],
];
const MAX_ROWS = 8;

const show = (v: AgentDraft[Key]): string => (Array.isArray(v) ? v.join(", ") : String(v));

export function diffDrafts(
  mine: AgentDraft,
  latest: AgentDraft,
  label: (key: string) => string,
): { rows: DiffRow[]; more: number } {
  const rows: DiffRow[] = [];
  for (const [k, l] of FIELDS) {
    const a = show(mine[k]);
    const b = show(latest[k]);
    if (a === b) continue;
    rows.push({ path: label(l), mine: a, latest: b, mineEmpty: a === "", latestEmpty: b === "" });
  }
  return { rows: rows.slice(0, MAX_ROWS), more: Math.max(0, rows.length - MAX_ROWS) };
}
