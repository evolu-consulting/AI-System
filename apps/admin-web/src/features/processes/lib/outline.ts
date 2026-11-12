// CR-127 · U1 · FLOW-FR-12…14 · spec §8.1: lớp THUẦN chuyển `stages` (định dạng lưu: `step` + `next_step` + đích theo SỐ BƯỚC) ⇄ cây
// "danh sách dọc": Bắt đầu → bước → Nếu (hai nhánh Đúng / Sai, nhập lại) → Hoàn tất. Không đổi định dạng lưu, không React, không API.
//   stagesToOutline(stages) ⇒ Outline | Unsupported{reason}   outlineToStages(outline) ⇒ stages (đánh số lại theo thứ tự đọc)
// Cây giữ NGUYÊN mọi trường của stage (cấu hình node, `ui`, `slot`…) — chỉ bỏ `step`/`next_step` (do cây quyết định) và đổi đích-theo-số
// thành đích-theo-MÃ BƯỚC (`StepRefs`) để thêm/xoá/chuyển bước không làm lệch đích. Số bước còn nằm trong `stage.executor`/`after` là CŨ,
// KHÔNG có nghĩa — đọc `refs`. Cấu trúc không biểu diễn được (nhiều bước chạy song song, cạnh nhảy tự do…) ⇒ `Unsupported` kèm lý do.
import { type ProcessStageDef, resolveSteps } from "@ai/contracts/hub-admin";
import {
  applyRefs,
  fail,
  nextTarget,
  type OutlineExit,
  type OutlineNode,
  readRefs,
  type StepRefs,
  type Unsupported,
} from "./outline-refs";

export type {
  OutlineExit,
  OutlineNode,
  StepRefs,
  Unsupported,
  UnsupportedCode,
} from "./outline-refs";

/** Cây đọc được: `items` = đường chính từ Bắt đầu; `exits` = node Kết thúc chỉ được trỏ tới bởi Từ chối / Trả lại / rẽ nhánh (không nằm trên đường chính). */
export type Outline = { kind: "outline"; items: OutlineNode[]; exits: OutlineExit[] };
export type OutlineResult = Outline | Unsupported;

export const isUnsupported = (r: OutlineResult): r is Unsupported => r.kind === "unsupported";
const isEnd = (s: ProcessStageDef): boolean => s.outcome !== undefined;

/** Bỏ `step` / `next_step` khỏi bản sao stage (cây quyết định; `outlineToStages` ghi lại). */
function strip(s: ProcessStageDef): ProcessStageDef {
  const c = structuredClone(s);
  delete c.step;
  delete c.next_step;
  return c;
}

type Seq = { items: OutlineNode[]; terminated: boolean };

/** Chuyển stages ⇒ cây; ném `Fail` bên trong, bắt ở `stagesToOutline`. */
class Builder {
  private readonly byStep: ProcessStageDef[];
  private readonly keyOf: (step: number) => string | undefined;
  private readonly isEndStep: (step: number) => boolean;
  private readonly visited = new Set<number>();
  private readonly reach = new Map<number, Set<number>>();
  readonly n: number;

  constructor(stages: readonly ProcessStageDef[]) {
    this.n = stages.length;
    const steps = resolveSteps(stages);
    const slots: (ProcessStageDef | undefined)[] = Array.from({ length: this.n });
    stages.forEach((s, i) => {
      const st = steps[i] as number;
      if (!Number.isInteger(st) || st < 0 || st >= this.n || slots[st])
        throw fail(
          "parallel_steps",
          `Quy trình có nhiều bước cùng chạy một lúc (bước «${s.name}»): chỉ xem được, tạo quy trình mới từ sơ đồ trống để vẽ lại.`,
          s.key,
        );
      slots[st] = s;
    });
    this.byStep = slots as ProcessStageDef[];
    const keys = new Set<string>();
    for (const s of stages) {
      if (keys.has(s.key))
        throw fail("duplicate_key", `Hai bước trùng mã «${s.key}»: sửa mã bước rồi mở lại.`, s.key);
      keys.add(s.key);
    }
    this.keyOf = (st) => this.byStep[st]?.key;
    this.isEndStep = (st) =>
      this.byStep[st] !== undefined && isEnd(this.byStep[st] as ProcessStageDef);
  }

  /** Mọi bước tới được từ `s` theo đường đi của engine (gồm chính nó và điểm kết thúc ảo `n`); Kết thúc không đi tiếp. */
  private reachable(s: number): Set<number> {
    const hit = this.reach.get(s);
    if (hit) return hit;
    const out = new Set<number>([s]);
    if (s < this.n) for (const t of this.targets(s)) for (const x of this.reachable(t)) out.add(x);
    this.reach.set(s, out);
    return out;
  }

  /** Bước kế của stage ở bước `s` theo đường đi (không tính Từ chối / Trả lại / rẽ chờ: đó là lối thoát tới Kết thúc). */
  private targets(s: number): number[] {
    const st = this.byStep[s] as ProcessStageDef;
    if (isEnd(st)) return [];
    const e = st.executor as { kind: string; then_step?: number; else_step?: number | null };
    if (e.kind === "if")
      return [
        this.checkTarget(st, s, e.then_step ?? s + 1),
        this.checkTarget(st, s, e.else_step ?? s + 1),
      ];
    return [this.checkTarget(st, s, nextTarget(st, s))];
  }

  /** Đích tiến về sau, trong def (hoặc điểm kết thúc ảo `n` khi là bước mặc định cuối cùng). */
  private checkTarget(st: ProcessStageDef, own: number, t: number): number {
    if (!Number.isInteger(t) || t <= own || t > this.n || (t === this.n && t !== own + 1))
      throw fail(
        "bad_target",
        `Bước «${st.name}» trỏ tới một bước không có hoặc nằm phía trước: sửa đích của bước này rồi mở lại.`,
        st.key,
      );
    return t;
  }

  private nodeRefs(st: ProcessStageDef): StepRefs {
    return readRefs(st, this.keyOf, this.isEndStep);
  }

  /** Nếu: tìm điểm nhập lại (bước nhỏ nhất cả hai nhánh cùng tới), dựng hai nhánh tới đó. `merge = null` ⇒ hai nhánh kết thúc riêng. */
  private parseIf(st: ProcessStageDef, s: number): { node: OutlineNode; merge: number | null } {
    const e = st.executor as { then_step?: number; else_step?: number | null };
    const yesAt = this.checkTarget(st, s, e.then_step ?? s + 1);
    const noAt = this.checkTarget(st, s, e.else_step ?? s + 1);
    const noReach = this.reachable(noAt);
    const both = [...this.reachable(yesAt)].filter((x) => noReach.has(x));
    const merge = both.length === 0 ? null : Math.min(...both);
    const yes = this.parseSeq(yesAt, merge).items;
    const no = this.parseSeq(noAt, merge).items;
    return { node: { kind: "if", stage: strip(st), refs: this.nodeRefs(st), yes, no }, merge };
  }

  private rejoin(st: ProcessStageDef) {
    return fail(
      "rejoin",
      `Bước «${st.name}» được nhiều đường cùng đi vào ngoài chỗ nhập lại của «Nếu»: chỉ xem được, tạo quy trình mới từ sơ đồ trống.`,
      st.key,
    );
  }

  private parseSeq(start: number, stop: number | null): Seq {
    const items: OutlineNode[] = [];
    let s = start;
    while (s < this.n && s !== stop) {
      const st = this.byStep[s] as ProcessStageDef;
      if ((stop !== null && s > stop) || this.visited.has(s)) throw this.rejoin(st);
      this.visited.add(s);
      const kind = (st.executor as { kind: string }).kind;
      if (isEnd(st)) {
        items.push({ kind: "end", stage: strip(st), refs: this.nodeRefs(st) });
        return { items, terminated: true };
      }
      if (kind === "if") {
        const r = this.parseIf(st, s);
        items.push(r.node);
        if (r.merge === null) return { items, terminated: true };
        s = r.merge;
        continue;
      }
      items.push({ kind: "step", stage: strip(st), refs: this.nodeRefs(st) });
      s = this.checkTarget(st, s, nextTarget(st, s));
    }
    if (stop !== null && s !== stop)
      throw fail(
        "rejoin",
        "Hai nhánh của «Nếu» không gặp lại nhau: chỉ xem được, tạo quy trình mới từ sơ đồ trống.",
      );
    return { items, terminated: false };
  }

  build(): Outline {
    const main = this.parseSeq(0, null);
    const exits: OutlineExit[] = [];
    this.byStep.forEach((st, s) => {
      if (this.visited.has(s)) return;
      if (!isEnd(st))
        throw fail(
          "orphan",
          `Bước «${st.name}» không nối với đường chính từ Bắt đầu: chỉ xem được, tạo quy trình mới từ sơ đồ trống.`,
          st.key,
        );
      exits.push({ kind: "end", stage: strip(st), refs: this.nodeRefs(st) });
    });
    return { kind: "outline", items: main.items, exits };
  }
}

/** Def/stages ⇒ cây. Rỗng, nhiều bước cùng chạy một lúc, cạnh nhảy tự do, nhánh không nhập lại, bước mồ côi… ⇒ `Unsupported` (lý do tiếng Việt, mã `code`). */
export function stagesToOutline(stages: readonly ProcessStageDef[]): OutlineResult {
  if (stages.length === 0)
    return { kind: "unsupported", code: "empty", reason: "Quy trình chưa có bước nào." };
  try {
    return new Builder(stages).build();
  } catch (e) {
    if (isFail(e)) return e.unsupported;
    throw e;
  }
}

function isFail(e: unknown): e is { unsupported: Unsupported } {
  return typeof e === "object" && e !== null && "unsupported" in e;
}

// ── cây ⇒ stages ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Duyệt cây theo thứ tự đọc: mỗi `if` đi stage → nhánh Đúng → nhánh Sai (cũng là thứ tự đánh số bước). */
export function walkOutline(items: readonly OutlineNode[], f: (n: OutlineNode) => void): void {
  for (const n of items) {
    f(n);
    if (n.kind === "if") {
      walkOutline(n.yes, f);
      walkOutline(n.no, f);
    }
  }
}

/** Mọi node theo thứ tự đọc: đường chính rồi `exits` (= thứ tự đánh số bước khi lưu). */
export function outlineNodes(o: Outline): OutlineNode[] {
  const out: OutlineNode[] = [];
  walkOutline(o.items, (n) => out.push(n));
  return [...out, ...o.exits];
}

/**
 * Cây ⇒ stages (`step` đánh lại 0.. theo thứ tự đọc). Bước cuối nhánh có `next_step` về điểm nhập lại; bước kế tiếp mặc định thì không
 * ghi `next_step`. Nhánh Nếu nhập lại mà phía sau không còn bước nào ⇒ `next_step` = số bước (bị `flowDefIssues` báo lỗi: thêm Hoàn tất,
 * xem `withDefaultEnds`). Đích đã bị xoá khỏi cây: Từ chối / Trả lại ⇒ `null`; mục rẽ nhánh bị bỏ.
 */
export function outlineToStages(o: Outline): ProcessStageDef[] {
  const nodes = outlineNodes(o);
  const stepOf = new Map(nodes.map((n, i) => [n.stage.key, i]));
  const total = nodes.length;
  const out: ProcessStageDef[] = [];
  const put = (n: OutlineNode, extra: { next?: number; yes?: number; no?: number }) => {
    const s = applyRefs(n.stage, n.refs, (k) => stepOf.get(k));
    const own = stepOf.get(n.stage.key) as number;
    if (n.kind === "if") {
      const e = s.executor as { then_step?: number; else_step?: number | null };
      e.then_step = extra.yes as number;
      e.else_step = extra.no as number;
    }
    out[own] = { ...s, step: own, ...(extra.next === undefined ? {} : { next_step: extra.next }) };
  };
  const seq = (items: readonly OutlineNode[], cont: number, tail: boolean) => {
    items.forEach((n, i) => {
      const last = i === items.length - 1;
      const after = last ? cont : (stepOf.get((items[i + 1] as OutlineNode).stage.key) as number);
      const own = stepOf.get(n.stage.key) as number;
      if (n.kind === "if") {
        const first = (xs: readonly OutlineNode[]) =>
          xs[0] ? (stepOf.get(xs[0].stage.key) as number) : after;
        put(n, { yes: first(n.yes), no: first(n.no) });
        seq(n.yes, after, true);
        seq(n.no, after, true);
        return;
      }
      const explicit = n.kind === "step" && (after !== own + 1 || (last && tail));
      put(n, explicit ? { next: after } : {});
    });
  };
  seq(o.items, total, false);
  for (const x of o.exits) put(x, {});
  return out;
}
