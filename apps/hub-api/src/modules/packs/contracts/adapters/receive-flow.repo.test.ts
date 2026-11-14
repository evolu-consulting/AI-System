// fix-review-r2 · luật thuần bên NHẬN HĐ: ngưỡng mặc định + người phụ trách ghi vào HĐ nhận.
import { describe, expect, it } from "bun:test";
import { receiveOwnerOf, receiveParamsOf } from "./receive-flow.repo";

const M = 1_000_000;
describe("receiveOwnerOf · người phụ trách ghi vào HĐ nhận", () => {
  it("người đã đặt còn dùng được (actor = người đó) ⇒ chính họ", () => {
    expect(receiveOwnerOf("u1", "u1")).toBe("u1");
  });
  it("người đã đặt KHÔNG còn dùng được ⇒ null (kể cả khi có quản trị làm actor): HĐ vẫn vào, quản trị thấy «chưa có người phụ trách»", () => {
    expect(receiveOwnerOf("u1", "admin")).toBeNull();
    expect(receiveOwnerOf("u1", null)).toBeNull();
  });
  it("chưa đặt người phụ trách ⇒ quản trị công ty (actor) như cũ; không có ai ⇒ null", () => {
    expect(receiveOwnerOf(null, "admin")).toBe("admin");
    expect(receiveOwnerOf(null, null)).toBeNull();
  });
});

describe("receiveParamsOf", () => {
  it("thiếu ngưỡng ⇒ mặc định 500 triệu / 2 tỷ; có ⇒ triệu đồng đổi sang VND", () => {
    expect(receiveParamsOf({})).toEqual({
      importantMin: 500 * M,
      criticalMin: 2000 * M,
      ownerId: null,
    });
    expect(
      receiveParamsOf({ important_min_m: 100, critical_min_m: 300, owner_user_id: "u" }),
    ).toEqual({
      importantMin: 100 * M,
      criticalMin: 300 * M,
      ownerId: "u",
    });
  });
});
