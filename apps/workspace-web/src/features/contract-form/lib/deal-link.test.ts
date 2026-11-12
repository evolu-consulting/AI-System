// CR-127 · U6 · M12: «Thuộc hợp đồng nào?» — bắt buộc khi có mốc mở; Không theo HĐ cần lý do; gắn mốc cần bằng chứng; tách theo thân API.
import { describe, expect, test } from "bun:test";
import { EMPTY_EVIDENCE } from "~/platform/flow/lib/evidence";
import { EMPTY_EXTRA, toDealRequest } from "./deal-form";
import { linkBody, linkDirection, linkIssue, remainingNum, UNSET_LINK } from "./deal-link";
import { EMPTY_FORM } from "./form-model";

const proof = { note: "Giao 400 thùng, khách ký nhận", signatureId: "sig1", fileIds: [] };

describe("linkIssue", () => {
  test("không có mốc mở ⇒ không bắt chọn", () => {
    expect(linkIssue(UNSET_LINK, 0, EMPTY_EVIDENCE)).toBeNull();
  });
  test("có mốc mở mà chưa chọn ⇒ required", () => {
    expect(linkIssue(UNSET_LINK, 2, EMPTY_EVIDENCE)).toBe("required");
  });
  test("Không theo hợp đồng cần lý do", () => {
    expect(linkIssue({ kind: "none", reason: "  " }, 2, EMPTY_EVIDENCE)).toBe("reason");
    expect(linkIssue({ kind: "none", reason: "Khách lẻ" }, 2, EMPTY_EVIDENCE)).toBeNull();
  });
  test("chọn mốc cần ý kiến + chữ ký hoặc tệp", () => {
    const c = { kind: "milestone", obligationId: "o1" } as const;
    expect(linkIssue(c, 1, EMPTY_EVIDENCE)).toBe("evidence");
    expect(linkIssue(c, 1, { note: "ok", signatureId: null, fileIds: [] })).toBe("evidence");
    expect(linkIssue(c, 1, proof)).toBeNull();
    expect(linkIssue(c, 1, { note: "ok", signatureId: null, fileIds: ["f1"] })).toBeNull();
  });
});

describe("linkBody / toDealRequest", () => {
  test("mốc ⇒ link.obligation_id + bằng chứng; không theo HĐ ⇒ lý do đã cắt khoảng trắng; chưa chọn ⇒ không gửi", () => {
    expect(linkBody({ kind: "milestone", obligationId: "o1" }, proof)).toEqual({
      link: { obligation_id: "o1" },
      evidence: { note: "Giao 400 thùng, khách ký nhận", signature_attachment_id: "sig1" },
    });
    expect(linkBody({ kind: "none", reason: " Khách lẻ " }, EMPTY_EVIDENCE)).toEqual({
      link: { none: { reason: "Khách lẻ" } },
    });
    expect(linkBody(UNSET_LINK, proof)).toEqual({});
  });
  test("thân tạo giao dịch mang link; vắng khi chưa chọn", () => {
    const f = { ...EMPTY_FORM, title: "GD", partner_name: "A", deal: "sell" as const };
    const n = { value: null, commission_pct: null, commission_fixed: null } as never;
    const body = toDealRequest(f, n, [], { ...EMPTY_EXTRA, source: "invoice" });
    expect("link" in body).toBe(false);
    const b2 = toDealRequest(f, n, [], {
      ...EMPTY_EXTRA,
      source: "invoice",
      link: { kind: "none", reason: "lẻ" },
    });
    expect(b2.link).toEqual({ none: { reason: "lẻ" } });
  });
});

describe("hướng + phần còn lại", () => {
  test("Bán ⇒ sale, Mua ⇒ purchase, Giới thiệu ⇒ không gắn", () => {
    expect(linkDirection("sell")).toBe("sale");
    expect(linkDirection("buy")).toBe("purchase");
    expect(linkDirection("referral")).toBeNull();
  });
  test("remainingNum: số ⇒ số; null/chữ ⇒ null", () => {
    expect(remainingNum("650")).toBe(650);
    expect(remainingNum(null)).toBeNull();
    expect(remainingNum("n/a")).toBeNull();
  });
});
