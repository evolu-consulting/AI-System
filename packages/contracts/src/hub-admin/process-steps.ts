// HUB-FR-104 · HUB-BR-38 · HUB-FR-118 · HUB-FR-136 · P-b2 (plan §1.2): hàm THUẦN về bước của def + cắt Bàn giao — dùng
// chung server (superRefine, `validateProcessDef`, seed) và admin-web (editor canvas). Không import zod/schema (tránh vòng).
import {
  ESCALATE_AFTER_H,
  HANDOFF_CHARS_PER_TOKEN,
  HANDOFF_TOKENS_MAX,
  PROCESS_STEP_STAGES_MAX,
  WAIT_OFFSET_DAYS,
  WAIT_TIME_RE,
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
  // P-d1 · PD-R17 stage `wait_until` (`waitStageIssues`) · PD-R23 chuyển cấp (`escalateStageIssues`).
  "WAIT_INVALID",
  "ESCALATE_INVALID",
  // HUB-FR-143 · D7 · stage team sequential/parallel_merge: mục bắt buộc không thành viên nào phụ trách.
  "TEAM_SECTION_UNOWNED",
  // P-d2 · PD2-R01/R02 stage `tool` (`toolStageIssues`) · PD2-R12 rẽ nhánh (`branchStageIssues`) — `process-tools.ts`.
  "TOOL_INVALID",
  "TOOL_SIDE_EFFECT",
  "BRANCH_INVALID",
  // CR-103 · R4 · node `set` (`setDefIssues`, hub-api domain/set).
  "SET_INVALID",
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

/** Hình stage mà `processDefStageIssues` nhận (def đã parse, snapshot cũ, bản nháp FE). */
export type ProcessDefStageDraft = StepStageShape &
  Partial<Omit<ApplyStageShape, keyof StepStageShape>> &
  Partial<Omit<WaitStageShape, keyof StepStageShape>> & { after: EscalateStageShape["after"] };
/** P-d1 · ngữ cảnh def: vắng `inputs` ⇒ bỏ kiểm nguồn input của `wait_until` (giữ test khoá cũ). */
export type ProcessDefIssueCtx = {
  inputs?: readonly DefInputShape[];
  /** HUB-FR-143 · team_id → chế độ + mục từng thành viên; vắng ⇒ bỏ kiểm `TEAM_SECTION_UNOWNED`. */
  teams?: ReadonlyMap<string, TeamSectionsInfo>;
};
/** Thông tin nhóm đủ cho luật mục bắt buộc (mỗi phần tử `memberSections` = `sections` của một thành viên). */
export type TeamSectionsInfo = { mode: string; memberSections: readonly (readonly string[])[] };
type TeamSectionStage = {
  executor?: { kind: string; team_id?: string };
  output?: { required_sections?: readonly string[]; fields?: unknown };
};

/**
 * Vi phạm luật chéo stage (plan §1.2): i tăng; trong stage key → step → real_action → back; rồi tự-sửa, Áp,
 * `wait_until`, chuyển cấp (P-d1, plan-contract §3); cắt ≤ 20.
 */
export function processDefStageIssues(
  stages: readonly ProcessDefStageDraft[],
  ctx?: ProcessDefIssueCtx,
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
  return [
    ...base,
    ...auto,
    ...applyStageIssues(shaped),
    ...waitStageIssues(shaped, ctx?.inputs),
    ...escalateStageIssues(stages),
    ...teamSectionIssues(stages, ctx?.teams),
  ].slice(0, ISSUES_MAX);
}

/**
 * HUB-FR-143 · D7 · TEAM_SECTION_UNOWNED: stage `team` (nhóm sequential | parallel_merge) có mục trong
 * `output.required_sections` mà không thành viên nào phụ trách — path `stages.<i>.output.required_sections`.
 * `lead_plan` miễn (mục không giao được lấp "—"). Cùng điều kiện với luật domain `teamSectionIssues` (server).
 */
export function teamSectionIssues(
  stages: readonly TeamSectionStage[],
  teams: ReadonlyMap<string, TeamSectionsInfo> | undefined,
): ProcessDefIssue[] {
  if (!teams) return [];
  const out: ProcessDefIssue[] = [];
  stages.forEach((s, i) => {
    const teamId = s.executor?.kind === "team" ? s.executor.team_id : undefined;
    const team = teamId === undefined ? undefined : teams.get(teamId);
    if (!team || team.mode === "lead_plan") return;
    const owned = new Set(team.memberSections.flat());
    if ((s.output?.required_sections ?? []).some((r) => !owned.has(r)))
      out.push({ path: `stages.${i}.output.required_sections`, rule: "TEAM_SECTION_UNOWNED" });
  });
  return out;
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

// ── P-d1 · luật def `wait_until` + chuyển cấp (FE validate live; CÙNG điều kiện + path với luật domain — A2, A8) ──
/** Input khai báo của def (chỉ cần `key` + `type`). */
export type DefInputShape = { key: string; type: string };
type WaitFromDraft = { kind: string; key?: string; stage_key?: string; field?: string };
/** Hình tối thiểu cho luật `wait_until` (bản nháp: `offset_days`/`time` chưa qua zod). */
export type WaitStageShape = StepStageShape & {
  executor: { kind: string; from?: WaitFromDraft; offset_days?: unknown; time?: unknown };
  sources?: readonly unknown[];
  must_know?: readonly unknown[];
  autofix?: unknown;
  output?: { fields?: readonly { key: string; type: string }[] };
};
/** Hình tối thiểu cho luật chuyển cấp. */
export type EscalateStageShape = StepStageShape & {
  after: StepStageShape["after"] & {
    group_id?: string | null;
    escalate?: { after_h: number; group_id: string } | null;
  };
};

/** Nguồn ngày hợp lệ: input `date` đã khai (bỏ qua khi `inputs` vắng) / field `date` của stage ở bước NHỎ HƠN. */
function waitFromValid(
  stages: readonly WaitStageShape[],
  steps: readonly number[],
  i: number,
  inputs: readonly DefInputShape[] | undefined,
): boolean {
  const from = stages[i]?.executor.from;
  if (from?.kind === "input")
    return inputs === undefined || inputs.some((d) => d.key === from.key && d.type === "date");
  if (from?.kind !== "field") return false;
  const j = stages.findIndex((p) => p.key === from.stage_key);
  if (j < 0 || (steps[j] as number) >= (steps[i] as number)) return false;
  const f = stages[j]?.output?.fields?.find((x) => x.key === from.field);
  return f?.type === "date";
}

const offsetValid = (v: unknown): boolean =>
  Number.isInteger(v) &&
  (v as number) >= WAIT_OFFSET_DAYS.min &&
  (v as number) <= WAIT_OFFSET_DAYS.max;
const timeValid = (v: unknown): boolean =>
  v === undefined || (typeof v === "string" && WAIT_TIME_RE.test(v));
/** real_action / sources / must_know / autofix ⇒ một issue `stages.<i>.executor`. */
const waitExtraSet = (s: WaitStageShape): boolean =>
  s.real_action ||
  (s.sources?.length ?? 0) > 0 ||
  (s.must_know?.length ?? 0) > 0 ||
  (s.autofix ?? null) !== null;

/**
 * PD-R17 · WAIT_INVALID cho stage `executor.kind = wait_until`; thứ tự trong stage + path theo bảng plan-addendum A2:
 * `after` → `executor.from` → `executor.offset_days` → `executor.time` → `executor`.
 */
export function waitStageIssues(
  stages: readonly WaitStageShape[],
  inputs?: readonly DefInputShape[],
): ProcessDefIssue[] {
  const steps = resolveSteps(stages);
  const out: ProcessDefIssue[] = [];
  const add = (path: string) => out.push({ path, rule: "WAIT_INVALID" });
  stages.forEach((s, i) => {
    if (s.executor.kind !== "wait_until") return;
    if (s.after.kind !== "auto") add(`stages.${i}.after`);
    if (!waitFromValid(stages, steps, i, inputs)) add(`stages.${i}.executor.from`);
    if (!offsetValid(s.executor.offset_days)) add(`stages.${i}.executor.offset_days`);
    if (!timeValid(s.executor.time)) add(`stages.${i}.executor.time`);
    if (waitExtraSet(s)) add(`stages.${i}.executor`);
  });
  return out;
}

/**
 * PD-R23 · ESCALATE_INVALID: `escalate ≠ null` ∧ (after ≠ review | Group chuyển cấp = Group duyệt |
 * `after_h ∉ 4…2160`) — path `stages.<i>.after.escalate`. Group tồn tại/cùng tenant xét ở server (PROCESS_REF_INVALID).
 */
export function escalateStageIssues(stages: readonly EscalateStageShape[]): ProcessDefIssue[] {
  const out: ProcessDefIssue[] = [];
  stages.forEach((s, i) => {
    const e = s.after.escalate ?? null;
    if (e === null) return;
    const h = e.after_h;
    const badH = !Number.isInteger(h) || h < ESCALATE_AFTER_H.min || h > ESCALATE_AFTER_H.max;
    if (s.after.kind !== "review" || e.group_id === s.after.group_id || badH)
      out.push({ path: `stages.${i}.after.escalate`, rule: "ESCALATE_INVALID" });
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
