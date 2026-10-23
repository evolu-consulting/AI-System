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
  it("409 nghiệp vụ không bị báo 'người khác cập nhật': thiếu tồn ⇒ câu máy chủ + gợi ý; mốc đã xác nhận ⇒ câu riêng", () => {
    const t = (k: string) => k;
    const stock = new ApiError(
      409,
      "STOCK_INSUFFICIENT" as never,
      "Không đủ tồn: Thùng carton cần 8000, còn 0",
    );
    expect(saveErrorText(stock, t)).toBe(
      "Không đủ tồn: Thùng carton cần 8000, còn 0. contracts.errors.stockHint",
    );
    expect(saveErrorText(new ApiError(409, "OBLIGATION_DONE" as never, "done"), t)).toBe(
      "contracts.errors.alreadyDone",
    );
    expect(saveErrorText(new ApiError(409, "CONTRACT_STALE" as never, "stale"), t)).toBe(
      "contracts.errors.conflict",
    );
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

describe("save wording (needs_review)", () => {
  it("nhãn nút + thông báo", async () => {
    const { saveLabelKey, savedNoticeKey } = await import("./review");
    expect(saveLabelKey(true)).toBe("contracts.review.saveDraft");
    expect(saveLabelKey(false)).toBe("contracts.cform.saveChanges");
    expect(savedNoticeKey("needs_review", false)).toBe("contracts.review.savedDraft");
    expect(savedNoticeKey("needs_review", true)).toBe("contracts.cform.reviewSavedActive");
    expect(savedNoticeKey("active", false)).toBe("contracts.review.saved");
  });
});
