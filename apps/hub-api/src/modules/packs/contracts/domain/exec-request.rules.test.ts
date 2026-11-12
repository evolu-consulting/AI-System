// CR-127 · X3 · luật thuần: vai tạm khoá/thay đổi (R#18), tạm khoá chỉ khi còn hiệu lực, dữ kiện quy trình, PATCH mốc ở HĐ DONE (BR-53).
import { describe, expect, it } from "bun:test";
import {
  daysBetween,
  factsOf,
  holdable,
  mayChange,
  mayHold,
  patchRouteOf,
} from "./exec-request.rules";

const a = (o: Partial<Parameters<typeof mayHold>[0]> = {}) => ({
  userId: "u1",
  owner: "o1",
  createdBy: "c1",
  head: false,
  admin: false,
  ...o,
});

describe("CR-127 X3 · vai", () => {
  it("tạm khoá: owner ∪ trưởng phòng ∪ quản trị; người ghi khác ⇒ không", () => {
    expect(mayHold(a({ userId: "o1" }))).toBe(true);
    expect(mayHold(a({ head: true }))).toBe(true);
    expect(mayHold(a({ admin: true }))).toBe(true);
    expect(mayHold(a())).toBe(false);
  });
  it("yêu cầu thay đổi: owner ∪ quản trị (trưởng phòng KHÔNG tự động); chưa có owner ⇒ người tạo", () => {
    expect(mayChange(a({ userId: "o1" }))).toBe(true);
    expect(mayChange(a({ admin: true }))).toBe(true);
    expect(mayChange(a({ head: true }))).toBe(false);
    expect(mayChange(a({ userId: "c1", owner: null }))).toBe(true);
    expect(mayChange(a({ userId: "c1" }))).toBe(false);
  });
});

describe("CR-127 X3 · trạng thái / dữ kiện", () => {
  it("chỉ tạm khoá HĐ DONE còn hiệu lực, không bị thay thế", () => {
    expect(holdable({ status: "done", superseded: false, effect: "active" })).toBe(true);
    expect(holdable({ status: "done", superseded: false, effect: "expiring" })).toBe(true);
    expect(holdable({ status: "done", superseded: false, effect: "expired" })).toBe(false);
    expect(holdable({ status: "done", superseded: true, effect: "active" })).toBe(false);
    expect(holdable({ status: "processing", superseded: false, effect: null })).toBe(false);
  });
  it("dữ kiện quy trình theo loại; mở khoá dùng nhóm tạm khoá", () => {
    expect(daysBetween("2026-01-01", "2026-01-11")).toBe(10);
    expect(factsOf("postpone", { days: 10 })).toEqual({ kind: "postpone", postpone_days: 10 });
    expect(factsOf("waive_penalty", { waive: 5 })).toEqual({ kind: "waive", waive_amount: 5 });
    expect(factsOf("split", {})).toEqual({ kind: "split" });
    expect(factsOf("hold", {})).toEqual({ kind: "hold" });
    expect(factsOf("release", {})).toEqual({ kind: "hold" });
  });
  it("PATCH mốc HĐ DONE: chỉ due_date ⇒ dời hạn; khoá khác ⇒ phiên bản mới", () => {
    expect(patchRouteOf(["due_date"])).toBe("postpone");
    expect(patchRouteOf(["due_date", "evidence"])).toBe("postpone");
    expect(patchRouteOf(["due_date", "amount"])).toBe("use_new_version");
    expect(patchRouteOf(["title"])).toBe("use_new_version");
    expect(patchRouteOf(["evidence"])).toBe("use_new_version");
  });
});
