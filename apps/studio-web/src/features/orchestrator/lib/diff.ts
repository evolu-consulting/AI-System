// HUB-FR-69 · H4a-R09 · "Xem khác biệt" của ConflictDialog: các trường nháp của bạn khác bản mới nhất.
import type { DiffRow } from "#/components/shared/conflict/types";
import type { OrchDraft } from "./draft";

const FIELDS: [keyof OrchDraft, string][] = [
  ["agentId", "orch.diff.agent"],
  ["maxSteps", "orch.diff.maxSteps"],
  ["tokenBudget", "orch.diff.tokenBudget"],
  ["historyN", "orch.diff.historyN"],
  ["onNoMatch", "orch.diff.onNoMatch"],
];

/** `show(key, value)` đổi giá trị thô (id agent, answer|ask) sang chữ hiển thị. */
export function diffOrch(
  mine: OrchDraft,
  latest: OrchDraft,
  label: (key: string) => string,
  show: (key: keyof OrchDraft, value: string) => string,
): { rows: DiffRow[]; more: number } {
  const rows: DiffRow[] = [];
  for (const [k, l] of FIELDS) {
    if (mine[k] === latest[k]) continue;
    const a = show(k, mine[k]);
    const b = show(k, latest[k]);
    rows.push({ path: label(l), mine: a, latest: b, mineEmpty: a === "", latestEmpty: b === "" });
  }
  return { rows, more: 0 };
}
