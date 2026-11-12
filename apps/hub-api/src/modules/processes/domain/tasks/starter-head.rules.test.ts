// CR-139 · Q1 · luật thuần chọn «Trưởng phòng của người đề xuất» (khớp SQL `core/starter-head.sql.ts`).
import { describe, expect, it } from "bun:test";
import {
  type Dept,
  isStarterHead,
  pickStarterHead,
  starterHeadFallback,
} from "./starter-head.rules";

// P (hp) ← A (ha) ← C0 (không trưởng) ; B (hb) độc lập
const depts = new Map<string, Dept>([
  ["P", { parent: null, head: "hp" }],
  ["A", { parent: "P", head: "ha" }],
  ["C0", { parent: "A", head: null }],
  ["B", { parent: null, head: "hb" }],
]);
const all = () => true;

describe("pickStarterHead", () => {
  it("trưởng phòng của người gửi", () => {
    expect(pickStarterHead(depts, ["A"], "s", all)).toBe("ha");
  });
  it("phòng không trưởng ⇒ leo phòng cha", () => {
    expect(pickStarterHead(depts, ["C0"], "s", all)).toBe("ha");
  });
  it("trưởng là người gửi ⇒ cấp trên; trưởng gốc tự gửi ⇒ null", () => {
    expect(pickStarterHead(depts, ["A"], "ha", all)).toBe("hp");
    expect(pickStarterHead(depts, ["P"], "hp", all)).toBeNull();
  });
  it("trưởng không còn dùng được ⇒ bỏ qua, leo tiếp", () => {
    expect(pickStarterHead(depts, ["A"], "s", (u) => u !== "ha")).toBe("hp");
  });
  it("nhiều phòng: trưởng gần nhất; cùng bậc ⇒ group_id nhỏ nhất", () => {
    expect(pickStarterHead(depts, ["C0", "B"], "s", all)).toBe("hb");
    expect(pickStarterHead(depts, ["B", "A"], "s", all)).toBe("ha");
  });
  it("không thuộc phòng nào / phòng lạ ⇒ null; vòng cha–con không treo", () => {
    expect(pickStarterHead(depts, [], "s", all)).toBeNull();
    expect(pickStarterHead(depts, ["Z"], "s", all)).toBeNull();
    const loop = new Map<string, Dept>([
      ["L1", { parent: "L2", head: null }],
      ["L2", { parent: "L1", head: null }],
    ]);
    expect(pickStarterHead(loop, ["L1"], "s", all)).toBeNull();
  });
});

describe("isStarterHead / starterHeadFallback", () => {
  it("chỉ bước Duyệt có approver_mode='starter_head'", () => {
    expect(isStarterHead({ kind: "review", approver_mode: "starter_head" })).toBe(true);
    expect(isStarterHead({ kind: "review" })).toBe(false);
    expect(isStarterHead({ kind: "auto", approver_mode: "starter_head" })).toBe(false);
  });
  it("không ai ⇒ đích chuyển cấp ≠ người gửi, rồi quản trị công ty trừ người gửi", () => {
    const esc = { userId: null, groupId: null, adminIds: ["s", "ta"] };
    expect(starterHeadFallback("s", esc)).toEqual({ userIds: ["ta"], groupId: null });
    expect(starterHeadFallback("s", { ...esc, groupId: "g" })).toEqual({
      userIds: [],
      groupId: "g",
    });
    expect(starterHeadFallback("s", { ...esc, adminIds: ["s"] })).toBeNull();
  });
});
