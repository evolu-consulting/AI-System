// HUB-FR-106 · P-R03 · M3 · R-TM01…R-TM06 — `checkTemplate` (runs/template.rules.ts, plan-contract §7).
import { describe, expect, it } from "bun:test";
import { fn, loadProcRules } from "../../_support/modules";

const check = async () => fn(await loadProcRules("runs/template.rules.ts"), "checkTemplate");
const T2 = { requiredSections: ["Bảng ý", "Tổng tiền"], fields: [] };
const FIELDS = [
  { key: "tong_tien", type: "number", required: true },
  { key: "ngay", type: "date", required: true },
];
const fence = (body: string) => `\n\n\`\`\`fields\n${body}\n\`\`\`\n`;
const OK = "## Bảng ý\nHoá đơn HD-12.\n\n## Tổng tiền\n12 000 000";

describe("R-TM · kiểm template output [HUB-FR-106, M3]", () => {
  it("HUB-FR-106 · R-TM01 · đủ mục, thân không rỗng ⇒ ok, missing []", async () => {
    const r = (await check())(T2, OK);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it("HUB-FR-106 · R-TM02 · thiếu heading / thân rỗng / `###` ⇒ missing đúng tên", async () => {
    const f = await check();
    const a = f(T2, "## Bảng ý\nHoá đơn HD-12.");
    expect(a.ok).toBe(false);
    expect(a.missing).toEqual(["Tổng tiền"]);
    const b = f(T2, "## Bảng ý\n\n## Tổng tiền\n12 000 000");
    expect(b.ok).toBe(false);
    expect(b.missing).toEqual(["Bảng ý"]);
    const c = f(T2, "### Bảng ý\nHoá đơn.\n\n## Tổng tiền\n12");
    expect(c.ok).toBe(false);
    expect(c.missing).toEqual(["Bảng ý"]);
  });
  it("HUB-FR-106 · R-TM03 · `##   bảng Ý  ` khớp (không phân biệt hoa thường, trim)", async () => {
    const r = (await check())(T2, "##   bảng Ý  \nHoá đơn.\n\n## TỔNG TIỀN\n12");
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it("HUB-FR-106 · R-TM04 · khối ```fields``` ⇒ fields parse đúng kiểu", async () => {
    const md = OK + fence('{"tong_tien":12000000,"ngay":"2026-10-01"}');
    const r = (await check())({ ...T2, fields: FIELDS }, md);
    expect(r.ok).toBe(true);
    expect(r.fields).toEqual({ tong_tien: 12000000, ngay: "2026-10-01" });
    expect(r.fieldErrors).toEqual([]);
  });
  it("HUB-FR-106 · R-TM05 · thiếu trường required / sai kiểu / JSON hỏng ⇒ ok false, fieldErrors ≠ []", async () => {
    const f = await check();
    const t = { ...T2, fields: FIELDS };
    for (const body of [
      '{"ngay":"2026-10-01"}',
      '{"tong_tien":"abc","ngay":"2026-10-01"}',
      '{"tong_tien":',
    ]) {
      const r = f(t, OK + fence(body));
      expect(r.ok).toBe(false);
      expect(r.fieldErrors.length).toBeGreaterThan(0);
    }
  });
  it("HUB-FR-106 · R-TM06 · template không khai báo fields ⇒ `fields: null`", async () => {
    const r = (await check())(T2, OK);
    expect(r.fields).toBeNull();
  });
});
