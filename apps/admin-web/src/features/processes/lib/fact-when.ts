// CR-122 · U1 · FLOW2-FR-12/16: logic thuần của MỘT control dựng điều kiện (Bắt đầu khi + Nếu theo dữ kiện) trên `FactWhen`
// (AND/OR lồng 1 cấp, ≤ 6 vế mỗi cấp). Dữ kiện lấy từ `AppEventDecl.facts`; toán tử theo kiểu dữ kiện khớp `condOk` của contract.

import type { AppFactDecl, AppFactType } from "@ai/contracts/app-manifest";
import { type FactCond, type FactOp, type FactWhen, IF_CONDS_MAX } from "@ai/contracts/hub-admin";

type Group = { op: "and" | "or"; conds: FactCond[] };
export type WhenItem = FactCond | Group;
/** Đường dẫn tới vế lá: `[i]` ở cấp ngoài, `[g, j]` trong nhóm `g`. */
export type FactPath = readonly [number] | readonly [number, number];

export const isGroup = (x: WhenItem): x is Group => "conds" in x;

/** Toán tử cho phép theo kiểu dữ kiện (khớp `condOk`: so thứ tự chỉ số/ngày; `in` chỉ enum/phòng ban). */
export const OPS_BY_TYPE: Record<AppFactType, readonly FactOp[]> = {
  number: ["eq", "ne", "ge", "gt", "le", "lt"],
  date: ["eq", "ne", "ge", "gt", "le", "lt"],
  string: ["eq", "ne"],
  boolean: ["eq"],
  enum: ["in", "eq", "ne"],
  department: ["in"],
};

export const opsOf = (t: AppFactType): readonly FactOp[] => OPS_BY_TYPE[t] ?? ["eq"];

/** Vế mới cho một dữ kiện (giá trị mặc định hợp lệ theo kiểu). */
export function newFactCond(f: AppFactDecl): FactCond {
  const op = opsOf(f.type)[0] as FactOp;
  if (f.type === "number") return { fact: f.key, op, value: 0 };
  if (f.type === "boolean") return { fact: f.key, op, value: true };
  if (f.type === "enum") {
    const first = f.options?.[0]?.value;
    return op === "in"
      ? { fact: f.key, op, value: first ? [first] : [""] }
      : { fact: f.key, op, value: first ?? "" };
  }
  if (f.type === "department") return { fact: f.key, op: "in", value: [""] };
  return { fact: f.key, op, value: "" };
}

/** Đổi toán tử giữ giá trị hợp lệ: sang/khỏi `in` đổi dạng mảng ↔ giá trị đơn. */
export function withOp(c: FactCond, op: FactOp): FactCond {
  const v = c.value;
  if (op === "in") return { ...c, op, value: Array.isArray(v) ? v : [String(v)] };
  return { ...c, op, value: Array.isArray(v) ? (v[0] ?? "") : v };
}

const count = (w: FactWhen): number =>
  w.conds.reduce((n, x) => n + (isGroup(x as WhenItem) ? (x as Group).conds.length : 1), 0);

/** Tổng vế lá tối đa (6 mỗi cấp) — thêm vào cấp ngoài bị chặn khi đủ. */
export const canAddOuter = (w: FactWhen | null): boolean => !w || w.conds.length < IF_CONDS_MAX;
export const canAddGroup = (w: FactWhen, g: number): boolean => {
  const x = w.conds[g] as WhenItem | undefined;
  return !!x && isGroup(x) && x.conds.length < IF_CONDS_MAX;
};
export const leafCount = count;

export function whenAdd(when: FactWhen | null, f: AppFactDecl, group?: number): FactWhen {
  const c = newFactCond(f);
  const base: FactWhen = when ?? { op: "and", conds: [] };
  if (group === undefined) return canAddOuter(base) ? { ...base, conds: [...base.conds, c] } : base;
  return {
    ...base,
    conds: base.conds.map((x, i) =>
      i === group && isGroup(x as WhenItem) && canAddGroup(base, i)
        ? ({ ...(x as Group), conds: [...(x as Group).conds, c] } as FactWhen["conds"][number])
        : x,
    ),
  };
}

export function whenPatch(when: FactWhen, path: FactPath, c: FactCond): FactWhen {
  const [i, j] = path;
  return {
    ...when,
    conds: when.conds.map((x, k) => {
      if (k !== i) return x;
      if (j === undefined) return c;
      return isGroup(x as WhenItem)
        ? ({
            ...(x as Group),
            conds: (x as Group).conds.map((y, m) => (m === j ? c : y)),
          } as FactWhen["conds"][number])
        : x;
    }),
  };
}

/** Xoá một vế; nhóm hết vế bị bỏ; hết cả ⇒ null ("Luôn chạy"). */
export function whenRemove(when: FactWhen, path: FactPath): FactWhen | null {
  const [i, j] = path;
  const conds = (when.conds as WhenItem[]).flatMap((x, k): WhenItem[] => {
    if (k !== i) return [x];
    if (j === undefined) return [];
    if (!isGroup(x)) return [x];
    const rest = x.conds.filter((_, m) => m !== j);
    return rest.length > 0 ? [{ ...x, conds: rest }] : [];
  });
  return conds.length > 0 ? ({ ...when, conds } as FactWhen) : null;
}

/** Đổi vế lá ở cấp ngoài thành nhóm lồng (phép ngược phép ngoài). */
export function whenGroup(when: FactWhen, i: number): FactWhen {
  const x = when.conds[i] as WhenItem | undefined;
  if (!x || isGroup(x)) return when;
  const op = when.op === "and" ? "or" : "and";
  return {
    ...when,
    conds: when.conds.map((y, k) =>
      k === i ? ({ op, conds: [x] } as FactWhen["conds"][number]) : y,
    ),
  };
}

export function whenSetOp(when: FactWhen, op: "and" | "or", group?: number): FactWhen {
  if (group === undefined) return { ...when, op };
  return {
    ...when,
    conds: when.conds.map((x, i) =>
      i === group && isGroup(x as WhenItem)
        ? ({ ...(x as Group), op } as FactWhen["conds"][number])
        : x,
    ),
  };
}

/** Câu tóm tắt ngắn cho thẻ Bắt đầu khi: "Giá trị HĐ > 100000000 và Đối tác mới". */
export function whenSummary(
  when: FactWhen | null | undefined,
  facts: readonly AppFactDecl[],
  sym: (op: FactOp) => string,
  joiner: { and: string; or: string },
): string {
  if (!when) return "";
  const label = (k: string) => facts.find((f) => f.key === k)?.label ?? k;
  const one = (c: FactCond) =>
    `${label(c.fact)} ${sym(c.op)} ${Array.isArray(c.value) ? c.value.join(", ") : String(c.value)}`;
  const part = (x: WhenItem): string =>
    isGroup(x) ? `(${x.conds.map(one).join(` ${joiner[x.op]} `)})` : one(x);
  return (when.conds as WhenItem[]).map(part).join(` ${joiner[when.op]} `);
}
