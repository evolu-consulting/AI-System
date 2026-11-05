// CR-121 D-0 · điều kiện bước của mẫu luồng duyệt (tách từ `approval-flow.rules.ts`, giữ trần 400 dòng): AND/OR lồng một cấp trên
// loại HĐ, giá trị, phòng ban người tạo, đối tác mới; dữ liệu trống ⇒ điều kiện ĐÚNG (cần bước, như `needsLevel2`). Thuần, lớp 1.
import type { FlowCond, FlowCondGroup, FlowDeal, FlowWhen } from "./approval-flow.types";

/**
 * Giá trị HIỆN TẠI của HĐ lúc rẽ (sau sửa tay). `creator_departments` = mã Group của người tạo + mọi phòng cha (đã mở rộng sẵn ⇒
 * "tính cả phòng con"); `new_partner` = chưa có HĐ được duyệt với đối tác. Vắng/null ⇒ chưa có dữ liệu.
 */
export type FlowFacts = {
  deal: FlowDeal | null;
  total_value: unknown;
  creator_departments?: readonly string[] | null | undefined;
  new_partner?: boolean | null | undefined;
};

const validTotal = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Điều kiện có dữ liệu để xét không (preview "chưa có dữ liệu" khi false). */
export function condHasData(c: FlowCond, f: FlowFacts): boolean {
  if (c.field === "deal") return f.deal !== null;
  if (c.field === "total_value") return validTotal(f.total_value);
  if (c.field === "creator_department") return (f.creator_departments?.length ?? 0) > 0;
  return typeof f.new_partner === "boolean";
}

/** Một điều kiện; dữ liệu trống ⇒ ĐÚNG (an toàn: cần bước, như `needsLevel2`). */
export function condHolds(c: FlowCond, f: FlowFacts): boolean {
  if (!condHasData(c, f)) return true;
  if (c.field === "deal") return f.deal !== null && c.in.includes(f.deal);
  if (c.field === "creator_department")
    return c.in.some((k) => f.creator_departments?.includes(k) === true);
  if (c.field === "new_partner") return f.new_partner === c.is;
  const v = f.total_value as number;
  if (c.op === "ge") return v >= c.value;
  if (c.op === "gt") return v > c.value;
  if (c.op === "le") return v <= c.value;
  return v < c.value;
}

const isGroup = (c: FlowCond | FlowCondGroup): c is FlowCondGroup => !("field" in c);
const itemHolds = (c: FlowCond | FlowCondGroup, f: FlowFacts): boolean =>
  isGroup(c) ? whenHolds(c, f) : condHolds(c, f);

/** CR-121 D-1 · dữ kiện mở rộng mà mẫu chụp CẦN đọc (không điều kiện nào dùng ⇒ 0 câu SQL thêm khi rẽ/kết thúc). */
export type FactNeeds = { departments: boolean; partner: boolean };
type HasWhen = { kind: string; when?: FlowWhen | null };
const leaves = (w: FlowWhen | FlowCondGroup): FlowCond[] =>
  w.conds.flatMap((c) => (isGroup(c) ? leaves(c) : [c]));
export function factNeedsOf(steps: readonly HasWhen[]): FactNeeds {
  const fields = new Set(
    steps.flatMap((s) => (s.kind === "review" && s.when ? leaves(s.when) : [])).map((c) => c.field),
  );
  return { departments: fields.has("creator_department"), partner: fields.has("new_partner") };
}

/** AND/OR; phần tử là điều kiện lá hoặc nhóm lồng một cấp (`FlowCondGroup`). */
export function whenHolds(w: FlowWhen | FlowCondGroup | null, f: FlowFacts): boolean {
  if (w === null) return true;
  return w.op === "and"
    ? w.conds.every((c) => itemHolds(c, f))
    : w.conds.some((c) => itemHolds(c, f));
}
