// CR-101 DOC-deals · unit luật Giao dịch là chứng từ: mốc xác nhận ngay (Câu 4), điều kiện nâng (R10), ánh xạ tương thích, mã lỗi DB.
import { describe, expect, it } from "bun:test";
import { dealDbCode, legacyStatus, promoteVerdict, settleNowOrder } from "./deal.rules";

describe("deal.rules", () => {
  it("settleNowOrder: giao trước rồi tiền/hoa hồng; bỏ mốc đã xong, nhắc gia hạn, khác", () => {
    expect(
      settleNowOrder([
        { id: "pay", kind: "payment", status: "open" },
        { id: "renew", kind: "renewal", status: "open" },
        { id: "give", kind: "delivery", status: "open" },
        { id: "done", kind: "delivery", status: "done" },
        { id: "com", kind: "commission", status: "open" },
      ]),
    ).toEqual(["give", "pay", "com"]);
  });

  it("promoteVerdict: chỉ giao dịch hiện hành", () => {
    expect(promoteVerdict({ doc_type: "deal", superseded: false })).toBe("ok");
    expect(promoteVerdict({ doc_type: "contract", superseded: false })).toBe("not_deal");
    expect(promoteVerdict({ doc_type: "deal", superseded: true })).toBe("superseded");
  });

  it("legacyStatus: rejected ⇒ cancelled, còn lại posted", () => {
    expect(legacyStatus("rejected")).toBe("cancelled");
    expect(legacyStatus("active")).toBe("posted");
  });

  it("dealDbCode: EK422/EG410 + message ⇒ mã API; lỗi khác ⇒ null", () => {
    expect(dealDbCode({ code: "EK422", message: "PROMOTE_NEEDS_FILE" })).toBe("PROMOTE_NEEDS_FILE");
    expect(dealDbCode({ cause: { code: "EK422", message: "PROMOTE_INVALID" } })).toBe("NOT_A_DEAL");
    expect(dealDbCode({ code: "EG410", message: "USE_CONTRACTS" })).toBe("USE_CONTRACTS");
    expect(dealDbCode({ code: "23505", message: "PROMOTE_NEEDS_FILE" })).toBeNull();
    expect(dealDbCode({ code: "EK422", message: "FRAME_INVALID" })).toBeNull();
  });
});
