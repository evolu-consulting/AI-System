// CR-121 D-1 · dữ kiện mở rộng: `factNeedsOf` (chỉ đọc khi mẫu dùng) + `condHolds`/`whenHolds` với phòng ban (đã gồm phòng cha)
// và đối tác mới; thiếu dữ liệu ⇒ ĐÚNG (bước chạy).
import { describe, expect, it } from "bun:test";
import type { FlowCond, FlowWhen } from "./approval-flow.types";
import { condHolds, type FlowFacts, factNeedsOf, whenHolds } from "./approval-flow-cond.rules";

const base: FlowFacts = { deal: "buy", total_value: 600_000_000 };
const dept: FlowCond = { field: "creator_department", in: ["sales"] };
const fresh: FlowCond = { field: "new_partner", is: true };

describe("CR-121 D-1 · condHolds phòng ban / đối tác mới", () => {
  it("phòng con của sales (danh sách đã gồm phòng cha) ⇒ đúng; phòng khác ⇒ sai; chưa có ⇒ đúng", () => {
    expect(condHolds(dept, { ...base, creator_departments: ["sales", "sales-hn"] })).toBe(true);
    expect(condHolds(dept, { ...base, creator_departments: ["ops"] })).toBe(false);
    expect(condHolds(dept, { ...base, creator_departments: [] })).toBe(true);
    expect(condHolds(dept, base)).toBe(true);
  });
  it("đối tác mới: true/false theo dữ kiện; null ⇒ chưa có dữ liệu ⇒ đúng", () => {
    expect(condHolds(fresh, { ...base, new_partner: true })).toBe(true);
    expect(condHolds(fresh, { ...base, new_partner: false })).toBe(false);
    expect(condHolds(fresh, { ...base, new_partner: null })).toBe(true);
  });
  it("nhóm lồng: (sales và ≥ 500 tr) hoặc đối tác mới", () => {
    const w: FlowWhen = {
      op: "or",
      conds: [
        { op: "and", conds: [dept, { field: "total_value", op: "ge", value: 500_000_000 }] },
        fresh,
      ],
    };
    const f = { ...base, creator_departments: ["sales"], new_partner: false };
    expect(whenHolds(w, f)).toBe(true);
    expect(whenHolds(w, { ...f, total_value: 100_000_000 })).toBe(false);
    expect(whenHolds(w, { ...f, total_value: 100_000_000, new_partner: true })).toBe(true);
  });
});

describe("CR-121 D-1 · factNeedsOf", () => {
  const step = (when: FlowWhen | null) => ({ kind: "review", when });
  it("mẫu cũ (loại/giá trị) ⇒ không đọc thêm", () => {
    const w: FlowWhen = { op: "and", conds: [{ field: "total_value", op: "ge", value: 1 }] };
    expect(factNeedsOf([step(null), step(w)])).toEqual({ departments: false, partner: false });
  });
  it("điều kiện trong nhóm lồng vẫn được nhận", () => {
    const w: FlowWhen = { op: "or", conds: [{ op: "and", conds: [dept] }, fresh] };
    expect(factNeedsOf([step(null), step(w)])).toEqual({ departments: true, partner: true });
    expect(factNeedsOf([{ kind: "dify" }])).toEqual({ departments: false, partner: false });
  });
});
