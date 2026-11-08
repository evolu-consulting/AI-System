// CR-123 · p25 · FLOW3-FR-05/06/07 · phép sửa tay trên canvas — hàm THUẦN (xoá có nối liền, đặt lại cạnh, dán, kéo nhóm, thả từ bảng mẫu).
// Luật hợp lệ dùng chung ở `canvas-connect` (nối/nối lại) và `step-ops` (giới hạn bước, cột đầy); file này chỉ ghép chúng, không lặp lại luật.
import { PROCESS_STEP_STAGES_MAX } from "@ai/contracts/hub-admin";
import type { StageDraft } from "./draft-types";
import { withNodeDefaults } from "./node-defaults";
import { nextUid } from "./stage-convert";
import { getStagesMax } from "./stages-limit";
import {
  addStageToStep,
  ERR_STAGES_MAX,
  ERR_STEP_FULL,
  insertStepAfter,
  lastStep,
  normalizeSteps,
  type StepOpResult,
} from "./step-ops";
import { remapOne, remapStepRefs } from "./step-refs";
import { isSystemStage } from "./system-nodes";

export type EditError = "locked" | "last" | "ifReal" | "empty" | "already";
export type EditResult<T = StageDraft> = { stages: T[]; uids?: string[] } | { error: EditError };
export type OpResult =
  | EditResult
  | { error: typeof ERR_STAGES_MAX | typeof ERR_STEP_FULL; step?: number };

/** Bước đã có cấu hình (người dùng đã điền gì đó) ⇒ xoá cần hỏi lại; bước mới thả/chép chưa điền thì xoá thẳng. */
export function hasConfig(s: StageDraft): boolean {
  return !!(
    s.instruction.trim() ||
    s.executor ||
    s.groupId ||
    s.groupKey ||
    s.tool.key ||
    s.set.rows.length ||
    s.formFields?.length ||
    s.notifyRaw ||
    s.slotRaw ||
    s.ifx.yes !== null ||
    s.ifx.no !== null ||
    s.nextStep !== undefined ||
    s.mustKnow.trim() ||
    s.sources.length ||
    s.branch.length
  );
}

const identity = (stages: readonly StageDraft[]): Map<number, number> =>
  new Map(stages.map((s) => [s.step, s.step]));

/** Node Nếu đang trỏ vào bước `step` (0-based) — kể cả "Sai" bỏ trống (= bước kế). */
const ifPointsAt = (o: StageDraft, step: number): boolean =>
  o.executor === "if" &&
  (o.ifx.yes === step + 1 || o.ifx.no === step + 1 || (o.ifx.no === null && o.step + 1 === step));

/** Xoá giai đoạn `i`: bước đứng một mình trong cột ⇒ mọi đích tới nó được nối liền sang bước kế (A→B→C xoá B ⇒ A→C). */
function removeOne(stages: StageDraft[], i: number): EditResult {
  const s = stages[i] as StageDraft;
  const alone = !stages.some((o, j) => j !== i && o.step === s.step);
  let base = stages;
  if (alone && stages.some((o) => o.step === s.step + 1)) {
    const to = s.step + 1;
    if (stages.some((o) => o.step === to && o.real) && stages.some((o) => ifPointsAt(o, s.step)))
      return { error: "ifReal" };
    const m = identity(stages).set(s.step, to);
    base = stages.map((o) => (o.uid === s.uid ? o : remapOne(o, m)));
  }
  const next = normalizeSteps(base.filter((_, j) => j !== i));
  return { stages: remapStepRefs(base, next) };
}

/** Xoá nhiều giai đoạn (mỗi cái nối liền như `removeOne`). Bước hệ thống / bước cuối cùng ⇒ lỗi, không đổi gì. */
export function removeStages(stages: readonly StageDraft[], uids: readonly string[]): EditResult {
  const doomed = new Set(uids);
  if (stages.some((s) => doomed.has(s.uid) && isSystemStage(s))) return { error: "locked" };
  if (stages.filter((s) => !doomed.has(s.uid)).length < 1) return { error: "last" };
  let cur = [...stages];
  for (const uid of doomed) {
    const i = cur.findIndex((s) => s.uid === uid);
    if (i < 0) continue;
    const r = removeOne(cur, i);
    if (!("stages" in r)) return r;
    cur = r.stages;
  }
  return { stages: cur };
}

/** Xoá một cạnh = đặt đích của nó về mặc định "Bước tiếp theo" (Nếu: Đúng → bước kế nếu có, Sai → bỏ trống = bước kế). */
export function resetEdge(
  stages: readonly StageDraft[],
  e: { source: string; side?: "yes" | "no" | undefined },
): EditResult {
  const i = stages.findIndex((s) => s.uid === e.source);
  const s = stages[i];
  if (!s) return { error: "empty" };
  const out = [...stages];
  if (e.side) {
    const hasNext = stages.some((o) => o.step === s.step + 1);
    const def = e.side === "yes" && hasNext ? s.step + 2 : null;
    if (s.ifx[e.side] === def) return { error: "already" };
    out[i] = { ...s, ifx: { ...s.ifx, [e.side]: def } };
    return { stages: out };
  }
  if (s.nextStep === undefined) return { error: "already" };
  const { nextStep: _n, ...rest } = s;
  out[i] = rest as StageDraft;
  return { stages: out };
}

/** Đặt lại nhiều cạnh về mặc định (bỏ qua cạnh ra từ bước sắp bị xoá). `resets` = số cạnh thật sự đổi; `error` = lỗi cuối. */
export function resetEdges(
  stages: readonly StageDraft[],
  edges: readonly { source: string; side?: "yes" | "no" | undefined }[],
  skip: readonly string[],
): { stages: StageDraft[]; resets: number; error: EditError | null } {
  let cur = [...stages];
  let resets = 0;
  let error: EditError | null = null;
  for (const e of edges) {
    if (skip.includes(e.source)) continue;
    const r = resetEdge(cur, e);
    if ("stages" in r) {
      cur = r.stages;
      resets++;
    } else error = r.error;
  }
  return { stages: cur, resets, error };
}

/** Bước hợp lệ sau `own` (0-based): đích phải ở SAU bước mình, ngược lại bỏ. */
function sane(c: StageDraft): StageDraft {
  const later = (v: number | null | undefined): v is number => v != null && v > c.step;
  const later1 = (v: number | null): number | null => (v !== null && v - 1 > c.step ? v : null);
  const out: StageDraft = {
    ...c,
    ifx: { ...c.ifx, yes: later1(c.ifx.yes), no: later1(c.ifx.no) },
    branch: c.branch.map((b) => ({ ...b, goto: later1(b.goto) })),
  };
  if (!later(c.nextStep)) delete out.nextStep;
  return out;
}

function cloneForPaste(c: StageDraft, taken: string[], suffix: string): StageDraft {
  const name = `${c.name}${suffix}`;
  const base = withNodeDefaults(
    {
      ...c,
      uid: nextUid(),
      name,
      key: "",
      keyAuto: true,
      filename: "",
      template: "",
      backTo: [],
    },
    taken,
  );
  taken.push(base.key);
  const { uiY: _y, uiX: _x, ...rest } = base;
  return rest as StageDraft;
}

/**
 * Dán `copies` (bản chụp các giai đoạn đã chép) NGAY SAU bước `afterStep`: giữ quan hệ bước tương đối giữa chúng,
 * cạnh giữa các bản sao nối với nhau (không nối ngược về bản gốc), mã/tên mới. Vượt giới hạn bước ⇒ `ERR_STAGES_MAX`.
 */
export function pasteStages(
  stages: readonly StageDraft[],
  copies: readonly StageDraft[],
  afterStep: number,
  suffix: string,
): OpResult {
  const src = copies.filter((c) => !isSystemStage(c));
  if (src.length === 0) return { error: "empty" };
  if (stages.length + src.length > getStagesMax()) return { error: ERR_STAGES_MAX };
  const rel = [...new Set(src.map((c) => c.step))].sort((a, b) => a - b);
  const taken = stages.map((s) => s.key);
  const fresh = src.map((c) => ({
    ...cloneForPaste(c, taken, suffix),
    step: afterStep + 0.5 + rel.indexOf(c.step) * 0.01,
  }));
  const at = stages.reduce((m, o, j) => (o.step <= afterStep ? j + 1 : m), 0);
  const merged = [...stages];
  merged.splice(at, 0, ...fresh);
  const norm = remapStepRefs(stages, normalizeSteps(merged));
  const newStep = (uid: string) => norm.find((s) => s.uid === uid)?.step ?? 0;
  // đích trỏ vào một bước đã chép ⇒ trỏ vào bản sao của nó
  const m = identity(norm);
  for (const [k, c] of src.entries()) m.set(newStep(c.uid), newStep((fresh[k] as StageDraft).uid));
  const ids = new Set(fresh.map((f) => f.uid));
  const out = norm.map((s) => (ids.has(s.uid) ? sane(remapOne(s, m)) : s));
  return { stages: out, uids: fresh.map((f) => f.uid) };
}

/**
 * Kéo nhóm: dời mọi giai đoạn `uids` đi `delta` bước (luật cột của `moveToStep`: quá cuối ⇒ bước mới, cột tối đa 3).
 * Gộp thành MỘT lần chuẩn hoá nên thứ tự tương đối trong nhóm được giữ.
 */
export function moveGroup(
  stages: readonly StageDraft[],
  uids: readonly string[],
  delta: number,
): StepOpResult<StageDraft> {
  const moving = new Set(uids);
  const last = lastStep(stages);
  const moved = stages.map((s) =>
    moving.has(s.uid) ? { ...s, step: Math.min(Math.max(s.step + delta, 0), last + 1) } : s,
  );
  const counts = new Map<number, number>();
  for (const s of moved) counts.set(s.step, (counts.get(s.step) ?? 0) + 1);
  for (const [step, n] of counts)
    if (n > PROCESS_STEP_STAGES_MAX) return { error: ERR_STEP_FULL, step };
  return { stages: normalizeSteps(moved) };
}

/**
 * Thả các node dựng sẵn `fresh` (một node module có thể nhiều giai đoạn) vào CUỐI cột `step`; giai đoạn thứ hai trở đi
 * chèn tiếp ngay sau bước trước. `y` (nếu có) lưu thành vị trí dọc để node nằm đúng chỗ thả.
 */
export function placeFresh(
  stages: readonly StageDraft[],
  fresh: readonly StageDraft[],
  step: number,
  y: number | undefined,
  x?: number,
): StepOpResult<StageDraft> {
  let cur = [...stages];
  let after = step;
  for (const [k, f0] of fresh.entries()) {
    const f = withNodeDefaults(
      k === 0 && y !== undefined
        ? { ...f0, uiY: Math.round(y), ...(x === undefined ? {} : { uiX: Math.round(x) }) }
        : f0,
      cur.map((s) => s.key),
    );
    const r = k === 0 ? addStageToStep(cur, step, f) : insertStepAfter(cur, after, f);
    if ("error" in r) return r;
    cur = r.stages;
    after = cur.find((s) => s.uid === f.uid)?.step ?? after;
  }
  return { stages: cur };
}
