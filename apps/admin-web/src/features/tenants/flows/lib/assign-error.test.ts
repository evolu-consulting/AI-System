// CR-121 f6 · lỗi gán quy trình ⇒ câu nghiệp vụ + hành động; 422 lạ ⇒ gợi ý kiểm tra ứng dụng đã dùng.
import { describe, expect, it } from "bun:test";
import { assignErrorOf } from "./assign-error";

const ctx = { app: "Sổ Hợp Tác" };
describe("CR-121 f6 · assignErrorOf", () => {
  it("thiếu nhóm ⇒ nêu mã nhóm + dẫn tới Thành viên › Nhóm", () => {
    expect(
      assignErrorOf(
        { status: 422, code: "SLOT_GROUPS_MISSING", details: { keys: ["ke-toan", "giam-doc"] } },
        ctx,
      ),
    ).toEqual({
      key: "tenants.flows.err.groupsMissing",
      params: { keys: "ke-toan, giam-doc" },
      action: "groups",
    });
  });
  it("chưa xuất bản / còn lỗi cấu hình ⇒ dẫn tới Thư viện", () => {
    expect(assignErrorOf({ status: 422, code: "PROCESS_NOT_PUBLISHED" }, ctx)?.action).toBe(
      "library",
    );
    expect(assignErrorOf({ status: 422, code: "PROCESS_PUBLISH_INVALID" }, ctx)?.action).toBe(
      "library",
    );
  });
  it("tham chiếu người/nhóm ngoài công ty ⇒ dẫn tới Nhóm", () => {
    expect(assignErrorOf({ status: 422, code: "PROCESS_REF_INVALID" }, ctx)?.key).toBe(
      "tenants.flows.err.refInvalid",
    );
  });
  it("422 chưa có câu riêng ⇒ gợi ý kiểm tra công ty đã dùng ứng dụng (tab Ứng dụng)", () => {
    expect(assignErrorOf({ status: 422, code: "SOMETHING" }, ctx)).toEqual({
      key: "tenants.flows.err.unprocessable",
      params: { app: "Sổ Hợp Tác" },
      action: "apps",
    });
  });
  it("mã ROUTING_*, xung đột version, lỗi mạng ⇒ null (đã có câu riêng)", () => {
    expect(assignErrorOf({ status: 422, code: "ROUTING_PROCESS_UNAVAILABLE" }, ctx)).toBeNull();
    expect(assignErrorOf({ status: 409, code: "VERSION_CONFLICT" }, ctx)).toBeNull();
    expect(assignErrorOf(new Error("x"), ctx)).toBeNull();
    expect(assignErrorOf({ status: 500 }, ctx)).toBeNull();
  });
});
