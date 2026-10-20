// HD-FR-26 · S05: luật thuần màn HĐ (cảnh báo, dòng phụ, câu lỗi lưu). V2-F: form + PATCH ↔ `fields` ở `contract-form/lib/*.test.ts`.
import { describe, expect, it } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { leadKey, warningsOf } from "./review";
import { saveErrorText } from "./save-error";

describe("S05 · màn HĐ", () => {
  it("cảnh báo: chỉ phần có message; dòng phụ theo trạng thái", () => {
    expect(
      warningsOf({ warnings: [{ field: null, code: "vat_unknown", message: "x" }, 1, null] }),
    ).toHaveLength(1);
    expect(leadKey("extracting")).toBe("contracts.review.reading");
    expect(leadKey("needs_review")).toBe("contracts.review.checkLead");
    expect(leadKey("active")).toBeNull();
  });
  it("câu lỗi lưu: 409 ⇒ conflict, mạng ⇒ network, còn lại ⇒ unknown (không lộ thông điệp máy chủ)", () => {
    const t = (k: string) => k;
    expect(saveErrorText(new ApiError(409, "HTTP_ERROR", "stale"), t)).toBe(
      "contracts.errors.conflict",
    );
    expect(saveErrorText(new ApiError(0, "NETWORK_ERROR", "x"), t)).toBe(
      "contracts.errors.network",
    );
    expect(saveErrorText(new Error("SELECT * secret"), t)).toBe("contracts.errors.unknown");
  });
});
