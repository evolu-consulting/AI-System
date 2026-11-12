// CR-097 K2 · HD-FR-101 (cập nhật = phiên bản mới) · HD-FR-102 (xác nhận v2 thay v1) · BR-36b (chuyển mốc mở) · X5 (xoá).
// Luật thuần viết TRƯỚC code (làn đầy đủ: tiền/kho). SQL chuyển mốc theo tập: `version-milestones.repo.ts`.
import { describe, expect, it } from "bun:test";
import {
  type ChainRow,
  currentOf,
  deleteVerdict,
  diffFields,
  effectiveFrom,
  milestoneMovePlan,
  newVersionVerdict,
  openDraftOf,
} from "./versions.rules";

const row = (n: number, superseded: string | null = null, locked = true): ChainRow => ({
  id: `v${n}`,
  version_no: n,
  superseded_at: superseded,
  locked,
});

describe("HD-FR-102 · bản hiện hành của chuỗi", () => {
  it("một bản ⇒ chính nó; không có nháp", () => {
    expect(currentOf([row(1)])?.id).toBe("v1");
    expect(openDraftOf([row(1)])).toBeNull();
  });
  it("v1 hiện hành + v2 nháp ⇒ hiện hành v1, nháp v2", () => {
    const rows = [row(2, null, false), row(1)];
    expect(currentOf(rows)?.id).toBe("v1");
    expect(openDraftOf(rows)?.id).toBe("v2");
  });
  it("v1 đã thay ⇒ hiện hành v2 (kể cả v2 được mở lại, chưa khoá); không còn nháp", () => {
    const rows = [row(1, "2026-10-23T00:00:00Z"), row(2, null, false)];
    expect(currentOf(rows)?.id).toBe("v2");
    expect(openDraftOf(rows)).toBeNull();
  });
  it("chuỗi rỗng (không thấy) ⇒ null", () => {
    expect(currentOf([])).toBeNull();
  });
});

describe("HD-FR-101 · tải bản cập nhật", () => {
  const ok = {
    found: true,
    kind: "contract",
    superseded: false,
    locked: true,
    draft: false,
  } as const;
  it("HĐ hiện hành đã khoá, chưa có nháp ⇒ ok", () => {
    expect(newVersionVerdict(ok)).toBe("ok");
  });
  it("không thấy ⇒ NOT_FOUND (cả khi cờ khác sai)", () => {
    expect(newVersionVerdict({ ...ok, found: false, locked: false })).toBe("NOT_FOUND");
  });
  it("phụ lục ⇒ VERSION_NOT_ALLOWED (phiên bản ≠ phụ lục, decision 9)", () => {
    expect(newVersionVerdict({ ...ok, kind: "appendix" })).toBe("VERSION_NOT_ALLOWED");
  });
  it("bản đã bị thay ⇒ CONTRACT_SUPERSEDED", () => {
    expect(newVersionVerdict({ ...ok, superseded: true })).toBe("CONTRACT_SUPERSEDED");
  });
  it("chưa khoá (nháp / mở lại) ⇒ CONTRACT_NOT_LOCKED", () => {
    expect(newVersionVerdict({ ...ok, locked: false })).toBe("CONTRACT_NOT_LOCKED");
  });
  it("đã có bản nháp mở trong chuỗi ⇒ VERSION_DRAFT_EXISTS", () => {
    expect(newVersionVerdict({ ...ok, draft: true })).toBe("VERSION_DRAFT_EXISTS");
  });
});

describe("CR-127 K5 · BR-36b chuyển mốc mở sang v(n+1)", () => {
  const ob = (id: string, status: string) => ({ id, status });
  it("mốc mở ⇒ chuyển sang v(n+1); đã xong / huỷ / thay ⇒ ở lại v(n)", () => {
    const plan = milestoneMovePlan([
      ob("open1", "open"),
      ob("open2", "open"),
      ob("done", "done"),
      ob("replaced", "replaced"),
      ob("cancelled", "cancelled"),
    ]);
    expect(plan).toEqual({ move: ["open1", "open2"], stay: ["done", "replaced", "cancelled"] });
  });
  it("ngày hiệu lực v2 = ngày bắt đầu trên văn bản; trống ⇒ hôm nay (ngày lịch tenant)", () => {
    expect(effectiveFrom("2026-11-01", "2026-10-23")).toBe("2026-11-01");
    expect(effectiveFrom(null, "2026-10-23")).toBe("2026-10-23");
  });
});

describe("X5 · CR-097b xoá trong chuỗi", () => {
  it("HĐ một phiên bản ⇒ xoá được (như V2-M)", () => {
    expect(deleteVerdict({ versions: 1, draft: false })).toBe("ok");
  });
  it("bản nháp mới nhất trong chuỗi ⇒ xoá được (= bỏ bản cập nhật)", () => {
    expect(deleteVerdict({ versions: 2, draft: true })).toBe("ok");
  });
  it("bản đã xác nhận / hiện hành / đã thay trong chuỗi ⇒ CONTRACT_HAS_VERSIONS", () => {
    expect(deleteVerdict({ versions: 2, draft: false })).toBe("CONTRACT_HAS_VERSIONS");
  });
});

describe("UC-04 · so sánh hai phiên bản (trường pháp lý)", () => {
  const f = (v: unknown) => ({ value: v, quote: "x" });
  it("chỉ trả khoá khác giá trị (bỏ qua quote), theo thứ tự khoá cho trước", () => {
    const a = { number: f("HĐ-1"), total_value: f(100), end_date: f("2027-01-01") };
    const b = { number: f("HĐ-1"), total_value: f(120), end_date: f(null), notice_days: f(30) };
    expect(diffFields(a, b, ["number", "total_value", "end_date", "notice_days"])).toEqual([
      { key: "total_value", a: 100, b: 120 },
      { key: "end_date", a: "2027-01-01", b: null },
      { key: "notice_days", a: null, b: 30 },
    ]);
  });
  it("giá trị đối tượng/mảng so theo nội dung", () => {
    expect(diffFields({ k: f({ x: 1 }) }, { k: f({ x: 1 }) }, ["k"])).toEqual([]);
  });
});
