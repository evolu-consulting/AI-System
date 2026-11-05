// CR-121 D-3: logic thuần của trình dựng điều kiện bước "Chỉ chạy khi" (thay `whenParts`/`buildWhen` cũ — chỉ còn MỘT control).
// `FlowWhen` = nhóm và/hoặc một cấp: phần tử là điều kiện lá (`{field,…}`) hoặc nhóm lồng (`{op,conds}`). Trường + toán tử + giá trị
// theo `fields` của khe (Hub trả kèm danh sách khe); kiểu trường quyết hình điều kiện: số → `{op,value}`, enum/phòng ban → `{in}`, có-không → `{is}`.

import type { SlotFieldDto } from "@ai/contracts/hub-admin";
import {
  type FlowCond,
  type FlowCondGroup,
  type FlowWhen,
  isFlowCondGroup,
} from "@ai/contracts/pack-contracts";
import type { DealKind } from "../library-api";

export type ValueOp = "ge" | "gt" | "le" | "lt";
export type Combiner = "and" | "or";
/** Đường dẫn tới một điều kiện lá: `[i]` ở cấp ngoài, `[g, j]` trong nhóm `g`. */
export type CondPath = readonly [number] | readonly [number, number];
type Item = FlowCond | FlowCondGroup;

export const DEALS: readonly DealKind[] = ["buy", "sell", "referral"];
export const OP_SYMBOL: Record<string, string> = { ge: "≥", gt: ">", le: "≤", lt: "<" };
export const NUM_OPS: readonly ValueOp[] = ["ge", "gt", "le", "lt"];

/** Danh mục dự phòng khi Hub cũ chưa trả `fields` (đúng 4 trường của khe duyệt hợp đồng; nhãn lấy từ i18n khi có). */
export const DEFAULT_FIELDS: readonly SlotFieldDto[] = [
  {
    key: "deal",
    label: "Loại hợp đồng",
    type: "enum",
    ops: ["in"],
    options: DEALS.map((d) => ({ value: d, label: d })),
  },
  { key: "total_value", label: "Giá trị hợp đồng", type: "number", ops: [...NUM_OPS] },
  {
    key: "creator_department",
    label: "Phòng ban người gửi duyệt",
    type: "department",
    ops: ["in"],
  },
  { key: "new_partner", label: "Đối tác mới", type: "boolean", ops: ["is"] },
];

const asCond = (c: object) => c as FlowCond;
const asItem = (c: object) => c as Item;

/** Điều kiện mới cho một trường (giá trị mặc định hợp lệ nhất có thể; phòng ban để trống ⇒ báo thiếu tới khi chọn). */
export function newCond(f: SlotFieldDto): FlowCond {
  if (f.type === "number") {
    const op = f.ops.find((o) => o in OP_SYMBOL) ?? "ge";
    return asCond({ field: f.key, op, value: 0 });
  }
  if (f.type === "boolean") return asCond({ field: f.key, is: true });
  const first = f.type === "enum" ? f.options?.[0]?.value : undefined;
  return asCond({ field: f.key, in: first ? [first] : [] });
}

/** Thêm điều kiện: `group` = chỉ số nhóm lồng (vắng ⇒ cấp ngoài). `when` null ⇒ tạo mới (và). */
export function whenAdd(when: FlowWhen | null, f: SlotFieldDto, group?: number): FlowWhen {
  const c = newCond(f);
  const base: FlowWhen = when ?? { op: "and", conds: [] };
  if (group === undefined) return { ...base, conds: [...base.conds, c] };
  return {
    ...base,
    conds: base.conds.map((x, i) =>
      i === group && isFlowCondGroup(x) ? { ...x, conds: [...x.conds, c] } : x,
    ),
  };
}

/** Thay một điều kiện lá. */
export function whenPatch(when: FlowWhen, path: CondPath, c: FlowCond): FlowWhen {
  const [i, j] = path;
  return {
    ...when,
    conds: when.conds.map((x, k) => {
      if (k !== i) return x;
      if (j === undefined) return c;
      return isFlowCondGroup(x) ? { ...x, conds: x.conds.map((y, m) => (m === j ? c : y)) } : x;
    }),
  };
}

/** Xoá một điều kiện lá; nhóm hết phần tử bị bỏ; hết cả ⇒ null ("Luôn chạy"). */
export function whenRemove(when: FlowWhen, path: CondPath): FlowWhen | null {
  const [i, j] = path;
  const conds = when.conds.flatMap((x, k): Item[] => {
    if (k !== i) return [x];
    if (j === undefined) return [];
    if (!isFlowCondGroup(x)) return [x];
    const rest = x.conds.filter((_, m) => m !== j);
    return rest.length > 0 ? [{ ...x, conds: rest }] : [];
  });
  return conds.length > 0 ? { ...when, conds } : null;
}

/** Đổi điều kiện lá ở cấp ngoài thành nhóm lồng (nhóm dùng phép ngược với phép ngoài để thấy khác biệt). */
export function whenGroup(when: FlowWhen, i: number): FlowWhen {
  const x = when.conds[i];
  if (!x || isFlowCondGroup(x)) return when;
  const op: Combiner = when.op === "and" ? "or" : "and";
  return { ...when, conds: when.conds.map((y, k) => (k === i ? asItem({ op, conds: [x] }) : y)) };
}

/** Đổi phép ghép: `group` vắng ⇒ phép ngoài. */
export function whenSetOp(when: FlowWhen, op: Combiner, group?: number): FlowWhen {
  if (group === undefined) return { ...when, op };
  return {
    ...when,
    conds: when.conds.map((x, i) => (i === group && isFlowCondGroup(x) ? { ...x, op } : x)),
  };
}

/** Phần tử lá cuối cùng (kiểm/hiển thị theo thứ tự). */
export const leafList = (w: FlowWhen): { path: CondPath; cond: FlowCond }[] =>
  w.conds.flatMap((x, i): { path: CondPath; cond: FlowCond }[] =>
    isFlowCondGroup(x)
      ? x.conds.map((cond, j) => ({ path: [i, j] as const, cond }))
      : [{ path: [i] as const, cond: x }],
  );

const valueMissing = (c: FlowCond): boolean =>
  "in" in c
    ? c.in.length === 0
    : "value" in c
      ? !(Number.isInteger(c.value) && c.value >= 0)
      : false;

/** Mã lỗi (khoá `form.err.*`) của điều kiện: rỗng / trường ngoài danh mục / thiếu giá trị / số tiền sai. */
export function condIssueCodes(w: FlowWhen, fields: readonly SlotFieldDto[]): string[] {
  const out = new Set<string>();
  if (w.conds.length === 0) out.add("whenEmpty");
  for (const { cond } of leafList(w)) {
    const f = fields.find((x) => x.key === cond.field);
    if (!f) out.add("condFieldUnknown");
    else if ("value" in cond && !(Number.isInteger(cond.value) && cond.value >= 0))
      out.add("amountInvalid");
    else if (valueMissing(cond)) out.add("condValueEmpty");
  }
  return [...out];
}
