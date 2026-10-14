// HUB-FR-129 · PC2-R01 · P-c2 F2 (plan-frontend FC9/FC10): stage "Áp bản sửa" của editor — ép giá trị khoá + luật chéo dùng chung server.
// Hàm thuần: không React, không gọi API. Đổi kiểu giữ draft ô đã ẩn (FC9); ô ẩn chỉ bị bỏ qua khi gửi/validate (`normalizeApply`).

import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import { type ApplyStageShape, applyStageIssues } from "@ai/contracts/hub-admin";
import { emptyAutofix } from "./autofix-form";
import type { StageDraft } from "./def-form";

type Errors = Record<string, string>;

/** Giá trị `StageDraft.executor` của kiểu "Áp bản sửa" (khác `agent:<id>` / `team:<id>`). */
export const APPLY_EXECUTOR = "apply";
const A = "process.admin.apply.";

/** Mã luật `APPLY_*` (server + live) → khoá câu lỗi; path do contract trả. */
export const APPLY_RULE_ERR: Record<string, string> = {
  APPLY_NO_AUTOFIX: `${A}err.APPLY_NO_AUTOFIX`,
  APPLY_MAX: `${A}err.APPLY_MAX`,
  APPLY_REAL: `${A}err.APPLY_REAL`,
  APPLY_AFTER: `${A}err.APPLY_AFTER`,
  APPLY_FIELDS: `${A}err.APPLY_FIELDS`,
};

export const isApply = (s: Pick<StageDraft, "executor">): boolean => s.executor === APPLY_EXECUTOR;

/** Chọn "Áp bản sửa": `real_action` bật, `after` = auto (cả hai khoá trên UI). */
export const APPLY_PATCH: Partial<StageDraft> = {
  executor: APPLY_EXECUTOR,
  real: true,
  after: "auto",
  backTo: [],
  groupId: "",
};

/** Bản dùng để gửi/validate: stage Áp bỏ agent/chỉ dẫn/nguồn/ngân sách/tự sửa mã/must_know, ép real + auto. */
export function normalizeApply(s: StageDraft): StageDraft {
  if (!isApply(s)) return s;
  return {
    ...s,
    instruction: "",
    sources: [],
    mustKnow: "",
    budget: "",
    autofix: emptyAutofix(),
    real: true,
    after: "auto",
    backTo: [],
    groupId: "",
  };
}

/** Hình cho `applyStageIssues` (stage đã `normalizeApply`). */
function shapeOf(s: StageDraft): ApplyStageShape {
  return {
    key: s.key,
    step: s.step,
    real_action: s.real,
    executor: { kind: isApply(s) ? "apply" : s.executor.startsWith("team:") ? "team" : "agent" },
    after: { kind: s.after, back_to_steps: s.after === "review" ? s.backTo : [] },
    autofix: s.autofix.on ? { source_key: s.autofix.source } : null,
    sources: s.sources,
    token_budget: s.budget.trim() === "" ? null : Number(s.budget),
    must_know: s.mustKnow.trim() === "" ? [] : [s.mustKnow],
  };
}

/** Luật chéo stage Áp (dùng chung server: `applyStageIssues`) → danh sách {path, khoá} (một path có thể nhiều luật). */
export function applyIssueList(stages: readonly StageDraft[]): { path: string; key: string }[] {
  return applyStageIssues(stages.map((s) => shapeOf(normalizeApply(s)))).flatMap((i) => {
    const key = APPLY_RULE_ERR[i.rule];
    return key ? [{ path: i.path, key }] : [];
  });
}

/** Như `applyIssueList` nhưng theo path (luật đầu tiên thắng) — để gộp vào `validateDraft`. */
export function applyCrossErrors(stages: readonly StageDraft[]): Errors {
  const e: Errors = {};
  for (const i of applyIssueList(stages)) e[i.path] ??= i.key;
  return e;
}

/** Tên stage Áp đầu tiên (tham số `{{stage}}` của `APPLY_MAX`). */
export const firstApplyName = (stages: readonly StageDraft[]): string =>
  stages.find(isApply)?.name ?? "";

/** Khoá lỗi `APPLY_*` của stage `i` (path `stages.i`, `.executor`, `.after`, `.real_action`): live + lỗi từ server, không trùng. */
export function applyBlockErrors(
  live: readonly { path: string; key: string }[],
  server: Errors,
  i: number,
): string[] {
  const at = `stages.${i}`;
  const paths = new Set([at, `${at}.executor`, `${at}.after`, `${at}.real_action`]);
  const out = new Set<string>();
  for (const l of live) if (paths.has(l.path)) out.add(l.key);
  for (const p of paths) {
    const k = server[p];
    if (k?.startsWith(A)) out.add(k);
  }
  return [...out];
}

/** Khoá lỗi APPLY_*? (ô executor không in trùng — StageApply đã hiện). */
export const applyKeyOnly = (k: string | undefined): boolean => k?.startsWith(A) === true;

/** `StageDraft.executor` (`agent:<id>` | `team:<id>` | `apply`) → `executor` của contract. */
export function executorToDef(executor: string): ProcessStageDef["executor"] {
  if (executor === APPLY_EXECUTOR) return { kind: "apply" };
  const [kind, id = ""] = executor.split(":");
  return kind === "team" ? { kind: "team", team_id: id } : { kind: "agent", agent_id: id };
}
