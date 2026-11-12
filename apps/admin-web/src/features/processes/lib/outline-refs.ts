// CR-127 · U1 · phần của `outline.ts`: kiểu cây + đích-theo-MÃ BƯỚC (`StepRefs`) ⇄ đích-theo-SỐ BƯỚC của định dạng lưu. Thuần.
import type { ProcessStageDef } from "@ai/contracts/hub-admin";

/** Vì sao một flow không mở được dưới dạng danh sách dọc (chỉ xem). */
export type UnsupportedCode =
  | "empty"
  | "parallel_steps" // nhiều bước cùng một số bước, hoặc số bước trống / lệch
  | "duplicate_key"
  | "bad_target" // đích không tồn tại / nằm phía trước
  | "free_edge" // Từ chối / Trả lại / rẽ nhánh nhảy tới bước không phải Kết thúc
  | "rejoin" // nhiều đường đi vào một bước ngoài chỗ nhập lại của Nếu
  | "orphan"; // bước không nối từ Bắt đầu
export type Unsupported = {
  kind: "unsupported";
  code: UnsupportedCode;
  /** Câu tiếng Việt nghiệp vụ nói rõ vì sao và cách xử lý (UI hiển thị nguyên văn hoặc dịch theo `code`). */
  reason: string;
  /** Mã bước gây ra (nếu xác định được). */
  stageKey?: string;
};

/**
 * Đích của một bước theo MÃ bước (không theo số). Mọi trường đều tuỳ chọn; vắng = stage không có trường đó.
 *  - `reject` / `ret`: node Duyệt (Từ chối / Trả lại); `null` = chưa chọn (hành vi cổng cũ).
 *  - `branches`: `executor.branches[].goto_step` (chờ sự kiện / quy trình con), song song với mảng `branches` của stage.
 *  - `rules`: `after.branch[].goto_step`, song song với `after.branch`.
 *  - `back`: `after.back_to_steps` (bước được quay lại khi Chưa đạt).
 *  - `from`: nguồn `kind:'field'` của dòng gán (`executor.values[i].from.step`), song song với `values`; dòng khác ⇒ null.
 * Đích `reject` / `ret` / `branches` / `rules` luôn là node Kết thúc (đích khác ⇒ `Unsupported free_edge`).
 */
export type StepRefs = {
  reject?: string | null;
  ret?: string | null;
  branches?: string[];
  rules?: string[];
  back?: string[];
  from?: (string | null)[];
};

type NodeBase = { stage: ProcessStageDef; refs: StepRefs };
export type OutlineNode =
  | ({ kind: "step" } & NodeBase)
  | ({ kind: "if"; yes: OutlineNode[]; no: OutlineNode[] } & NodeBase)
  | ({ kind: "end" } & NodeBase);
/** Node Kết thúc nằm ngoài đường chính (chỉ Từ chối / Trả lại / rẽ nhánh trỏ tới). */
export type OutlineExit = Extract<OutlineNode, { kind: "end" }>;

export const fail = (code: UnsupportedCode, reason: string, stageKey?: string) => ({
  unsupported: {
    kind: "unsupported",
    code,
    reason,
    ...(stageKey ? { stageKey } : {}),
  } as Unsupported,
});

/** Bước kế mặc định của stage thường: `next_step` hoặc bước liền sau. */
export const nextTarget = (st: ProcessStageDef, own: number): number => st.next_step ?? own + 1;

type Exec = {
  kind: string;
  reject_step?: number | null;
  return_step?: number | null;
  branches?: { goto_step: number }[];
  values?: { from?: { kind?: string; step?: number } }[];
};
type After = { branch?: { goto_step: number }[]; back_to_steps?: number[] };
const exec = (s: ProcessStageDef): Exec => s.executor as unknown as Exec;
const after = (s: ProcessStageDef): After => s.after as unknown as After;

type Keyer = {
  /** Đích là node Kết thúc (lối thoát). */
  exit: (n: number) => string;
  /** Đích dữ liệu (bước trước bất kỳ). */
  data: (n: number) => string;
};

function keyer(
  st: ProcessStageDef,
  keyOf: (step: number) => string | undefined,
  isEndStep: (step: number) => boolean,
): Keyer {
  const must = (n: number, why: string): string => {
    const k = keyOf(n);
    if (k === undefined)
      throw fail("bad_target", `Bước «${st.name}» ${why}: sửa rồi mở lại.`, st.key);
    return k;
  };
  return {
    exit: (n) => {
      const k = must(n, "trỏ tới một bước không có");
      if (!isEndStep(n))
        throw fail(
          "free_edge",
          `Bước «${st.name}» rẽ thẳng sang bước «${k}» mà không phải Kết thúc: danh sách dọc chưa biểu diễn được, chỉ xem, muốn đổi thì tạo quy trình mới từ sơ đồ trống.`,
          st.key,
        );
      return k;
    },
    data: (n) => must(n, "dùng dữ liệu của một bước không có"),
  };
}

const keyOrNull = (
  n: number | null | undefined,
  f: (n: number) => string,
): string | null | undefined => (n === undefined ? undefined : n === null ? null : f(n));

function execRefs(e: Exec, k: Keyer): StepRefs {
  const refs: StepRefs = {};
  if (e.kind === "approve") {
    const reject = keyOrNull(e.reject_step, k.exit);
    const ret = keyOrNull(e.return_step, k.exit);
    if (reject !== undefined) refs.reject = reject;
    if (ret !== undefined) refs.ret = ret;
  }
  if (e.branches) refs.branches = e.branches.map((b) => k.exit(b.goto_step));
  if (e.kind === "set" && e.values?.some((v) => v.from?.kind === "field"))
    refs.from = e.values.map((v) =>
      v.from?.kind === "field" && typeof v.from.step === "number" ? k.data(v.from.step) : null,
    );
  return refs;
}

/** Đọc mọi đích-theo-số của stage thành đích-theo-mã. `keyOf(step)` = mã bước; `isEndStep(step)` = bước đó là Kết thúc. */
export function readRefs(
  st: ProcessStageDef,
  keyOf: (step: number) => string | undefined,
  isEndStep: (step: number) => boolean,
): StepRefs {
  const k = keyer(st, keyOf, isEndStep);
  const a = after(st);
  const refs = execRefs(exec(st), k);
  if (a.branch && a.branch.length > 0) refs.rules = a.branch.map((b) => k.exit(b.goto_step));
  if (a.back_to_steps && a.back_to_steps.length > 0) refs.back = a.back_to_steps.map(k.data);
  return refs;
}

type To = (k: string | null | undefined) => number | null;
/** Giữ mục nào còn đích (mục nào đích đã bị xoá ⇒ bỏ), đổi `goto_step` sang số mới. */
const regoto = <B extends { goto_step: number }>(
  xs: B[],
  keys: (string | undefined)[],
  to: To,
): B[] =>
  xs.flatMap((b, i) => {
    const n = to(keys[i]);
    return n === null ? [] : [{ ...b, goto_step: n }];
  });

function applyExec(e: Exec, refs: StepRefs, to: To): void {
  if (e.kind === "approve") {
    if (refs.reject !== undefined) e.reject_step = to(refs.reject);
    if (refs.ret !== undefined) e.return_step = to(refs.ret);
  }
  if (e.branches && refs.branches) e.branches = regoto(e.branches, refs.branches, to);
  if (e.kind === "set" && e.values && refs.from)
    for (const [i, v] of e.values.entries()) {
      const n = to(refs.from[i]);
      if (v.from?.kind === "field" && n !== null) v.from.step = n;
    }
}

/** Ghi đích-theo-mã về đích-theo-số trên BẢN SAO stage (`stepOf` = mã ⇒ số bước mới; mã không còn ⇒ undefined). */
export function applyRefs(
  stage: ProcessStageDef,
  refs: StepRefs,
  stepOf: (key: string) => number | undefined,
): ProcessStageDef {
  const s = structuredClone(stage);
  const a = after(s);
  const to: To = (k) => (k === null || k === undefined ? null : (stepOf(k) ?? null));
  applyExec(exec(s), refs, to);
  if (a.branch && refs.rules) a.branch = regoto(a.branch, refs.rules, to);
  if (a.back_to_steps && refs.back)
    a.back_to_steps = refs.back.flatMap((k) => {
      const n = to(k);
      return n === null ? [] : [n];
    });
  return s;
}
