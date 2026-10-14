// HUB-FR-104 · HUB-BR-38 · HUB-FR-118 · HUB-FR-136 · P-b2 (plan §1.2): hàm THUẦN về bước của def + cắt Bàn giao — dùng
// chung server (superRefine, `validateProcessDef`, seed) và admin-web (editor canvas). Không import zod/schema (tránh vòng).
import {
  HANDOFF_CHARS_PER_TOKEN,
  HANDOFF_TOKENS_MAX,
  PROCESS_STEP_STAGES_MAX,
} from "../chat/processes";

export const PROCESS_DEF_RULES = [
  "KEY_DUP",
  "REAL_ACTION",
  "STEP_INCOMPLETE",
  "STEP_ORDER",
  "STEP_TOO_WIDE",
  "BACK_TARGET_INVALID",
  "AUTOFIX_EXECUTOR",
  "AUTOFIX_REVIEW",
  "AUTOFIX_MAX",
  // P-c2 · PC2-R01 · stage Áp (`applyStageIssues`).
  "APPLY_REAL",
  "APPLY_AFTER",
  "APPLY_NO_AUTOFIX",
  "APPLY_MAX",
  "APPLY_FIELDS",
] as const;
export type ProcessDefRule = (typeof PROCESS_DEF_RULES)[number];
export type ProcessDefIssue = { path: string; rule: ProcessDefRule };
/** Trần số issue trả về (= `PROCESS_DEF_PATHS_MAX`). */
const ISSUES_MAX = 20;

/** Hình tối thiểu của stage def mà luật cần (nhận cả bản nháp FE / snapshot cũ thiếu `back_to_steps`). */
export type StepStageShape = {
  key: string;
  step?: number;
  real_action: boolean;
  after: { kind: string; back_to_steps?: readonly number[] };
};

const hasStep = (s: { step?: number }): boolean => typeof s.step === "number";

/** Bước của từng stage: mọi stage có `step` ⇒ giá trị đó; ngược lại (def cũ / chưa đủ) ⇒ chỉ số stage. */
export function resolveSteps(stages: readonly { step?: number }[]): number[] {
  if (stages.length > 0 && stages.every(hasStep)) return stages.map((s) => s.step as number);
  return stages.map((_, i) => i);
}

/** Nhóm chỉ số stage theo bước (bước tăng dần; trong bước: idx tăng dần). */
export function stepGroups(stages: readonly { step?: number }[]): number[][] {
  const by = new Map<number, number[]>();
  resolveSteps(stages).forEach((step, i) => {
    const g = by.get(step);
    if (g) g.push(i);
    else by.set(step, [i]);
  });
  return [...by.keys()].sort((a, b) => a - b).map((k) => by.get(k) as number[]);
}

type Bucket = {
  key: ProcessDefIssue[];
  step: ProcessDefIssue[];
  real: ProcessDefIssue[];
  back: ProcessDefIssue[];
};

/** STEP_INCOMPLETE / STEP_ORDER / STEP_TOO_WIDE; trả `true` khi bước chưa xác định (bỏ luật REAL/BACK). */
function stepIssues(stages: readonly StepStageShape[], out: Bucket[]): boolean {
  const any = stages.some(hasStep);
  if (!any) return false;
  if (!stages.every(hasStep)) {
    stages.forEach((s, i) => {
      if (!hasStep(s)) out[i]?.step.push({ path: `stages.${i}.step`, rule: "STEP_INCOMPLETE" });
    });
    return true;
  }
  const steps = stages.map((s) => s.step as number);
  const bad = steps.findIndex((v, i) =>
    i === 0 ? v !== 0 : v - (steps[i - 1] as number) > 1 || v < (steps[i - 1] as number),
  );
  if (bad >= 0) {
    out[bad]?.step.push({ path: `stages.${bad}.step`, rule: "STEP_ORDER" });
    return true;
  }
  const count = new Map<number, number>();
  steps.forEach((v, i) => {
    const n = (count.get(v) ?? 0) + 1;
    count.set(v, n);
    if (n > PROCESS_STEP_STAGES_MAX)
      out[i]?.step.push({ path: `stages.${i}.step`, rule: "STEP_TOO_WIDE" });
  });
  return false;
}

function realAndBackIssues(stages: readonly StepStageShape[], out: Bucket[]): void {
  const st = resolveSteps(stages);
  stages.forEach((s, i) => {
    const step = st[i] as number;
    if (s.real_action) {
      const prevAuto = stages.some((p, j) => st[j] === step - 1 && p.after.kind !== "review");
      if (step === 0 || prevAuto)
        out[i]?.real.push({ path: `stages.${i}.real_action`, rule: "REAL_ACTION" });
    }
    if (s.after.kind !== "review") return;
    const seen = new Set<number>();
    (s.after.back_to_steps ?? []).forEach((t, j) => {
      if (t >= step || seen.has(t)) {
        out[i]?.back.push({
          path: `stages.${i}.after.back_to_steps.${j}`,
          rule: "BACK_TARGET_INVALID",
        });
      }
      seen.add(t);
    });
  });
}

/** Vi phạm luật chéo stage (plan §1.2): i tăng; trong stage key → step → real_action → back; cắt ≤ 20. */
export function processDefStageIssues(
  stages: readonly (StepStageShape & Partial<Omit<ApplyStageShape, keyof StepStageShape>>)[],
): ProcessDefIssue[] {
  const out: Bucket[] = stages.map(() => ({ key: [], step: [], real: [], back: [] }));
  const seen = new Set<string>();
  stages.forEach((s, i) => {
    if (seen.has(s.key)) out[i]?.key.push({ path: `stages.${i}.key`, rule: "KEY_DUP" });
    seen.add(s.key);
  });
  if (!stepIssues(stages, out)) realAndBackIssues(stages, out);
  const base = out.flatMap((b) => [...b.key, ...b.step, ...b.real, ...b.back]);
  // Chữ ký cũ (P-a) không có `executor`/`autofix` ⇒ coi như stage thường.
  const shaped = stages.map((s) => ({ ...s, executor: s.executor ?? { kind: "agent" } }));
  const auto = autofixStageIssues(shaped);
  return [...base, ...auto, ...applyStageIssues(shaped)].slice(0, ISSUES_MAX);
}

/** P-c1 · hình tối thiểu cho luật stage tự-sửa. */
export type AutofixStageShape = StepStageShape & {
  executor: { kind: string };
  autofix?: { source_key: string } | null;
};

/** PC-R02 · stage tự-sửa: executor agent, `after` review, tối đa 1 stage tự-sửa/def (từ stage thứ 2 ⇒ AUTOFIX_MAX). */
export function autofixStageIssues(stages: readonly AutofixStageShape[]): ProcessDefIssue[] {
  const out: ProcessDefIssue[] = [];
  let seen = 0;
  stages.forEach((s, i) => {
    if (!s.autofix) return;
    if (s.executor.kind !== "agent")
      out.push({ path: `stages.${i}.executor`, rule: "AUTOFIX_EXECUTOR" });
    if (s.after.kind !== "review") out.push({ path: `stages.${i}.after`, rule: "AUTOFIX_REVIEW" });
    seen += 1;
    if (seen > 1) out.push({ path: `stages.${i}.autofix`, rule: "AUTOFIX_MAX" });
  });
  return out;
}

/** P-c2 · hình tối thiểu cho luật stage Áp (executor `apply`). */
export type ApplyStageShape = AutofixStageShape & {
  real_action: boolean;
  sources?: readonly unknown[];
  token_budget?: number | null;
  must_know?: readonly unknown[];
};

/** APPLY_FIELDS: stage Áp không nguồn / tự-sửa / ngân sách token / điều cần biết. */
const applyFieldsSet = (s: ApplyStageShape): boolean =>
  (s.sources?.length ?? 0) > 0 ||
  (s.autofix ?? null) !== null ||
  (s.token_budget ?? null) !== null ||
  (s.must_know?.length ?? 0) > 0;

/**
 * PC2-R01 · stage Áp: `real_action` bật, `after` auto, bước liền trước có stage tự-sửa, tối đa 1 stage Áp/def
 * (từ stage Áp thứ 2 ⇒ APPLY_MAX), các trường agent để trống. Bước theo `resolveSteps`.
 */
export function applyStageIssues(stages: readonly ApplyStageShape[]): ProcessDefIssue[] {
  const st = resolveSteps(stages);
  const out: ProcessDefIssue[] = [];
  let seen = 0;
  stages.forEach((s, i) => {
    if (s.executor.kind !== "apply") return;
    const step = st[i] as number;
    if (!s.real_action) out.push({ path: `stages.${i}.real_action`, rule: "APPLY_REAL" });
    if (s.after.kind !== "auto") out.push({ path: `stages.${i}.after`, rule: "APPLY_AFTER" });
    if (!stages.some((p, j) => st[j] === step - 1 && Boolean(p.autofix)))
      out.push({ path: `stages.${i}.executor`, rule: "APPLY_NO_AUTOFIX" });
    seen += 1;
    if (seen > 1) out.push({ path: `stages.${i}.executor`, rule: "APPLY_MAX" });
    if (applyFieldsSet(s)) out.push({ path: `stages.${i}`, rule: "APPLY_FIELDS" });
  });
  return out;
}

/** Chữ ký cũ (P-a): chỉ đường dẫn. */
export function processDefStagePaths(stages: readonly StepStageShape[]): string[] {
  return processDefStageIssues(stages).map((i) => i.path);
}

const HANDOFF_CHARS_MAX = HANDOFF_TOKENS_MAX * HANDOFF_CHARS_PER_TOKEN;

/** Ước lượng token Bàn giao = ceil(ký tự / 4) (đếm theo code point). */
export function handoffTokens(text: string): number {
  return Math.ceil(Array.from(text).length / HANDOFF_CHARS_PER_TOKEN);
}

/** > 800 ký tự ⇒ giữ 800 + "…" (cắt, không từ chối — HUB-FR-136(a)). */
export function clipHandoff(text: string): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= HANDOFF_CHARS_MAX) return { text, truncated: false };
  return { text: `${chars.slice(0, HANDOFF_CHARS_MAX).join("")}…`, truncated: true };
}
