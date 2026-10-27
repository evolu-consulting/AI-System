// CR-101 DOC-model · R43–R46 · luật thuần loại chứng từ + HĐ nguyên tắc (viết trước code).
import { describe, expect, it } from "bun:test";
import {
  attachVerdict,
  creditPct,
  dateOutsideFrame,
  frameMilestoneAllowed,
  frameStage,
  frameSummary,
  frameValue,
  parseDocTypeSuggest,
} from "./doc-types.rules";

describe("frameStage · giai đoạn HĐ NT theo hiệu lực (R44)", () => {
  const today = "2026-10-27";
  it("chưa tới ngày bắt đầu ⇒ not_started; trong khoảng ⇒ active; qua ngày kết thúc ⇒ expired", () => {
    expect(frameStage({ start: "2026-11-01", end: "2027-10-31", today })).toBe("not_started");
    expect(frameStage({ start: "2026-01-01", end: "2026-10-27", today })).toBe("active");
    expect(frameStage({ start: "2025-01-01", end: "2026-10-26", today })).toBe("expired");
  });
  it("thiếu ngày ⇒ phía đó mở", () => {
    expect(frameStage({ start: null, end: null, today })).toBe("active");
    expect(frameStage({ start: null, end: "2026-01-01", today })).toBe("expired");
    expect(frameStage({ start: "2027-01-01", end: null, today })).toBe("not_started");
  });
});

describe("frameValue · creditPct · giá trị = Σ con, % hạn mức (R45)", () => {
  it("cộng giá trị con, bỏ null và con bị từ chối", () => {
    expect(
      frameValue([
        { value: 100, status: "active" },
        { value: null, status: "active" },
        { value: 50, status: "needs_review" },
        { value: 999, status: "rejected" },
      ]),
    ).toBe(150);
    expect(frameValue([])).toBe(0);
  });
  it("% hạn mức một chữ số thập phân; không hạn mức / hạn mức 0 ⇒ null", () => {
    expect(creditPct(150, 1000)).toBe(15);
    expect(creditPct(1, 3)).toBe(33.3);
    expect(creditPct(1200, 1000)).toBe(120);
    expect(creditPct(100, null)).toBeNull();
    expect(creditPct(100, 0)).toBeNull();
  });
  it("frameSummary gộp giai đoạn + giá trị + % + số con", () => {
    expect(
      frameSummary(
        { start: "2026-01-01", end: "2026-12-31", creditLimit: 400 },
        [
          { value: 100, status: "active" },
          { value: 100, status: "active" },
        ],
        "2026-10-27",
      ),
    ).toEqual({ stage: "active", value: 200, credit_pct: 50, children: 2 });
  });
});

describe("dateOutsideFrame · cảnh báo ngày ngoài hiệu lực (R46, không chặn)", () => {
  const frame = { start: "2026-01-01", end: "2026-12-31" };
  it("trong khoảng ⇒ false; trước/sau ⇒ true; thiếu ngày ⇒ false", () => {
    expect(dateOutsideFrame("2026-06-01", frame)).toBe(false);
    expect(dateOutsideFrame("2025-12-31", frame)).toBe(true);
    expect(dateOutsideFrame("2027-01-01", frame)).toBe(true);
    expect(dateOutsideFrame(null, frame)).toBe(false);
    expect(dateOutsideFrame("2030-01-01", { start: null, end: null })).toBe(false);
  });
});

describe("frameMilestoneAllowed · mốc HĐ NT chỉ nhắc gia hạn + khác", () => {
  it("renewal, other ⇒ true; còn lại ⇒ false", () => {
    expect(
      ["renewal", "other", "payment", "delivery", "commission", "serial"].map(
        frameMilestoneAllowed,
      ),
    ).toEqual([true, true, false, false, false, false]);
  });
});

describe("attachVerdict · gắn con vào HĐ NT (R43, khớp trigger 0055)", () => {
  const frame = { docType: "framework", partnerKey: "tax:1", direction: "sale" } as const;
  const child = {
    docType: "contract",
    kind: "contract",
    partnerKey: "tax:1",
    direction: "sale",
  } as const;
  it("cùng đối tác + hướng ⇒ ok; bên còn trống ⇒ ok (chưa kết luận)", () => {
    expect(attachVerdict(frame, child)).toBe("ok");
    expect(attachVerdict(frame, { ...child, partnerKey: null, direction: null })).toBe("ok");
  });
  it("cha không phải HĐ NT ⇒ frame_invalid; con là HĐ NT / phụ lục ⇒ child_invalid", () => {
    expect(attachVerdict({ ...frame, docType: "contract" }, child)).toBe("frame_invalid");
    expect(attachVerdict(frame, { ...child, docType: "framework" })).toBe("child_invalid");
    expect(attachVerdict(frame, { ...child, kind: "appendix" })).toBe("child_invalid");
  });
  it("lệch đối tác hoặc hướng ⇒ partner_mismatch", () => {
    expect(attachVerdict(frame, { ...child, partnerKey: "tax:2" })).toBe("partner_mismatch");
    expect(attachVerdict(frame, { ...child, direction: "purchase" })).toBe("partner_mismatch");
  });
});

describe("parseDocTypeSuggest · AI gợi ý loại chứng từ (Câu 9)", () => {
  it("giá trị hợp lệ giữ; lạ/trống ⇒ null", () => {
    expect(parseDocTypeSuggest("framework")).toBe("framework");
    expect(parseDocTypeSuggest(" Contract ")).toBe("contract");
    expect(parseDocTypeSuggest("deal")).toBe("deal");
    expect(parseDocTypeSuggest("x")).toBeNull();
    expect(parseDocTypeSuggest(null)).toBeNull();
  });
});
