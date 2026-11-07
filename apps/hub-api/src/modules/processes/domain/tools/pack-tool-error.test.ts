// CR-107 · phân loại lỗi tool gói: lỗi nghiệp vụ ⇒ mã riêng ⇒ engine coi `business` (needs_decision ngay, không thử lại ~10,5');
// lỗi khác (DB/mạng) ⇒ `UPSTREAM_ERROR` ⇒ `transient` (thử lại như cũ).
import { describe, expect, it } from "bun:test";
import {
  PACK_TOOL_BUSINESS,
  PackToolBusinessError,
  packToolErrorCode,
} from "../../../packs/kit/domain/pack-tool-error";
import { classifyToolError } from "./tool-run.rules";

const cls = (code: string) =>
  classifyToolError({ code, httpStatus: null, sent: true, reason: null });

describe("CR-107 · packToolErrorCode", () => {
  it("lỗi nghiệp vụ ⇒ mã nghiệp vụ ⇒ business · lỗi thường ⇒ UPSTREAM_ERROR ⇒ transient", () => {
    const biz = packToolErrorCode(
      new PackToolBusinessError("contracts tool: required steps not passed"),
    );
    expect(biz).toBe(PACK_TOOL_BUSINESS);
    expect(cls(biz)).toBe("business");
    const db = packToolErrorCode(new Error("connection terminated unexpectedly"));
    expect(db).toBe("UPSTREAM_ERROR");
    expect(cls(db)).toBe("transient");
  });
  it("mã riêng hợp lệ giữ nguyên · mã sai dạng / trùng mã tạm thời ⇒ mã nghiệp vụ mặc định", () => {
    expect(packToolErrorCode(new PackToolBusinessError("x", "APPROVAL_NOT_OPEN"))).toBe(
      "APPROVAL_NOT_OPEN",
    );
    expect(packToolErrorCode(new PackToolBusinessError("x", "TIMEOUT"))).toBe(PACK_TOOL_BUSINESS);
    expect(packToolErrorCode(new PackToolBusinessError("x", "bad code"))).toBe(PACK_TOOL_BUSINESS);
    expect(packToolErrorCode("boom")).toBe("UPSTREAM_ERROR");
  });
});
