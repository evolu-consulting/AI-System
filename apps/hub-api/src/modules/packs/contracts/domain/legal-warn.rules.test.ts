import { describe, expect, test } from "bun:test";
import {
  LEGAL_REASON,
  LEGAL_WARN_DEFAULT,
  type LegalInput,
  legalWarning,
} from "./legal-warn.rules";

const base: LegalInput = {
  doc_type: "deal",
  frame_root_id: null,
  deal: "sell",
  value: 6_000_000,
  commission_pct: null,
  commission_fixed: null,
  open_money_milestones: 1,
  threshold: LEGAL_WARN_DEFAULT,
};

describe("legalWarning", () => {
  test("giao dịch đứng riêng ≥ ngưỡng, còn mốc tiền mở ⇒ cảnh báo", () => {
    expect(legalWarning(base)).toEqual({ threshold: 5_000_000, reason: LEGAL_REASON });
  });
  test("bằng ngưỡng vẫn cảnh báo; dưới ngưỡng thì không", () => {
    expect(legalWarning({ ...base, value: 5_000_000 })).not.toBeNull();
    expect(legalWarning({ ...base, value: 4_999_999 })).toBeNull();
  });
  test("hết mốc tiền mở ⇒ không", () => {
    expect(legalWarning({ ...base, open_money_milestones: 0 })).toBeNull();
  });
  test("thuộc HĐ NT / không phải giao dịch ⇒ không", () => {
    expect(legalWarning({ ...base, frame_root_id: "f" })).toBeNull();
    expect(legalWarning({ ...base, doc_type: "contract" })).toBeNull();
    expect(legalWarning({ ...base, doc_type: "framework" })).toBeNull();
  });
  test("ngưỡng 0 = tắt; giá trị trống ⇒ không", () => {
    expect(legalWarning({ ...base, threshold: 0 })).toBeNull();
    expect(legalWarning({ ...base, value: null })).toBeNull();
  });
  test("giới thiệu: tính theo hoa hồng dự kiến", () => {
    const r = { ...base, deal: "referral" as const, value: 100_000_000 };
    expect(legalWarning({ ...r, commission_fixed: 6_000_000 })).not.toBeNull();
    expect(legalWarning({ ...r, commission_pct: 3 })).toBeNull();
    expect(legalWarning({ ...r, commission_pct: 10 })).not.toBeNull();
  });
});
