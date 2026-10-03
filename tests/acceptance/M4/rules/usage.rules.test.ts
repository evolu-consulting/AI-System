// ADM-FR-42, ADM-BR-09 · M4-R08 · hàm thuần `modules/usage/usage.rules.ts` (test-plan R9–R13; chữ ký plan-rules §A5).
// Xanh ở T5. Module nạp động (`_modules.ts`): trước T5 mỗi ca đỏ vì "Cannot find module".
import { describe, expect, it } from "bun:test";
import { loadUsageRules } from "../_modules";

const U = () => loadUsageRules();
const A = "01900000-0000-7000-8000-000000000101";
const B = "01900000-0000-7000-8000-000000000102";
const iso = (x: unknown) => (x as Date).toISOString();
const DAY = 86_400_000;

describe("ADM-BR-09 · M4-R08 · resolveUsageTenant", () => {
  it("ADM-BR-09 · M4-R08 · tenant_admin: vắng/own → tenant mình; tenant khác → 'not_found'", async () => {
    const { resolveUsageTenant } = await U();
    const ta = { role: "tenant_admin", tenantId: A };
    expect(resolveUsageTenant(ta, undefined)).toEqual({ tenantId: A });
    expect(resolveUsageTenant(ta, A)).toEqual({ tenantId: A });
    expect(resolveUsageTenant(ta, B)).toBe("not_found");
  });

  it("ADM-FR-42 · M4-R08 · platform_admin: vắng → {tenantId:null} (mọi tenant); uuid → uuid đó", async () => {
    const { resolveUsageTenant } = await U();
    const pa = { role: "platform_admin", tenantId: B };
    expect(resolveUsageTenant(pa, undefined)).toEqual({ tenantId: null });
    expect(resolveUsageTenant(pa, A)).toEqual({ tenantId: A });
  });
});

describe("ADM-FR-42 · usageRange", () => {
  const now = new Date("2026-10-15T05:00:00Z");

  it("ADM-FR-42 · mặc định = tháng hiện tại (VN): from 09-30T17:00Z, to 10-31T17:00Z, 31 ngày; prev = 31 ngày liền trước", async () => {
    const { usageRange } = await U();
    const r = usageRange({}, now);
    expect(iso(r.from)).toBe("2026-09-30T17:00:00.000Z");
    expect(iso(r.to)).toBe("2026-10-31T17:00:00.000Z");
    expect(r.days).toHaveLength(31);
    expect(r.days[0]).toBe("2026-10-01");
    expect(r.days[30]).toBe("2026-10-31");
    expect(iso(r.prevTo)).toBe("2026-09-30T17:00:00.000Z");
    expect(iso(r.prevFrom)).toBe(
      new Date(Date.parse("2026-09-30T17:00:00Z") - 31 * DAY).toISOString(),
    );
  });

  it("ADM-FR-42 · from/to tường minh: to gồm cả ngày; days đủ mọi ngày; prev cùng độ dài liền trước", async () => {
    const { usageRange } = await U();
    const r = usageRange({ from: "2026-10-01", to: "2026-10-03" }, now);
    expect(iso(r.from)).toBe("2026-09-30T17:00:00.000Z");
    expect(iso(r.to)).toBe("2026-10-03T17:00:00.000Z");
    expect(r.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(iso(r.prevTo)).toBe("2026-09-30T17:00:00.000Z");
    expect(iso(r.prevFrom)).toBe("2026-09-27T17:00:00.000Z");
  });

  it("ADM-FR-42 · from > to → 'invalid'; 367 ngày → 'invalid'; 366 ngày → hợp lệ", async () => {
    const { usageRange } = await U();
    expect(usageRange({ from: "2026-10-10", to: "2026-10-01" }, now)).toBe("invalid");
    expect(usageRange({ from: "2025-01-01", to: "2026-01-02" }, now)).toBe("invalid");
    const ok = usageRange({ from: "2025-01-01", to: "2026-01-01" }, now);
    expect(ok).not.toBe("invalid");
    expect(ok.days).toHaveLength(366);
  });
});

describe("ADM-FR-42 · M4-R08 · CSV", () => {
  const TA = [
    "date",
    "tenant_key",
    "feature_key",
    "runs",
    "input_tokens",
    "output_tokens",
    "billable_usd",
    "overage_runs",
  ];

  it("ADM-FR-42 · M4-R08 · csvColumns: tenant_admin không có cost_usd; platform chèn cost_usd ngay sau billable_usd", async () => {
    const { csvColumns } = await U();
    expect([...csvColumns("tenant_admin")]).toEqual(TA);
    expect([...csvColumns("platform_admin")]).toEqual([
      ...TA.slice(0, 7),
      "cost_usd",
      "overage_runs",
    ]);
  });

  /** Ô CSV của một giá trị (bảng 1 cột): bỏ BOM + dòng tiêu đề, bỏ CRLF cuối nếu có. */
  async function cell(v: string | number | null): Promise<string> {
    const { toCsv } = await U();
    const out = toCsv(["v"], [{ v }]) as string;
    const body = out.slice(out.indexOf("\r\n") + 2);
    return body.endsWith("\r\n") ? body.slice(0, -2) : body;
  }
  const unquote = (c: string) => (c.startsWith('"') ? c.slice(1, -1).replaceAll('""', '"') : c);

  it("ADM-FR-42 · M4-R08 · toCsv: BOM U+FEFF, tiêu đề, dòng ngăn bằng CRLF; null → ô rỗng; số giữ nguyên", async () => {
    const { toCsv } = await U();
    const out = toCsv(
      ["a", "b", "c"],
      [
        { a: "x", b: null, c: 3 },
        { a: "y", b: "0.10", c: 0 },
      ],
    ) as string;
    expect(out.charCodeAt(0)).toBe(0xfeff);
    const lines = out.slice(1).split("\r\n");
    expect(lines.slice(0, 3)).toEqual(["a,b,c", "x,,3", "y,0.10,0"]);
    expect(out.slice(1).replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("ADM-FR-42 · M4-R08 · toCsv: ô có dấu phẩy, nháy kép, xuống dòng → bao nháy, nháy nhân đôi", async () => {
    expect(await cell("a,b")).toBe('"a,b"');
    expect(await cell('say "hi"')).toBe('"say ""hi"""');
    expect(await cell("x\ny")).toBe('"x\ny"');
  });

  it("ADM-FR-42 · M4-R08 · toCsv chống formula injection: ô bắt đầu = + - @ TAB CR → tiền tố ' (6 ca)", async () => {
    const cases = ["=1+2", "+1", "-2+3", "@SUM(A1)", "\tx", "\rx"];
    for (const v of cases) expect(unquote(await cell(v))).toBe(`'${v}`);
    const hl = '=HYPERLINK("http://evil.example","x")';
    const c = await cell(hl);
    expect(c.startsWith('"')).toBe(true);
    expect(unquote(c)).toBe(`'${hl}`);
    expect(await cell("ke-toan")).toBe("ke-toan");
  });

  it("ADM-FR-42 · M4-R08 · M4-AC03 · stripCost(tenant_admin) xoá đệ quy cost_usd, margin_usd, tenants; platform giữ nguyên", async () => {
    const { stripCost } = await U();
    const report = () => ({
      kpi: { runs: 2, billable_usd: "0.20", cost_usd: "0.12", margin_usd: "0.08" },
      previous: { runs: 1, cost_usd: "0.06", margin_usd: "0.04" },
      daily: [{ date: "2026-10-01", runs: 2, cost_usd: "0.12" }],
      top_features: [{ feature_key: "ke-toan", runs: 2, cost_usd: "0.12" }],
      top_users: [{ username: "an", runs: 2, cost_usd: "0.12" }],
      tenants: [{ tenant_key: "acme", cost_usd: "0.12" }],
    });
    const ta = stripCost("tenant_admin", report());
    const s = JSON.stringify(ta);
    expect(s).not.toContain("cost_usd");
    expect(s).not.toContain("margin_usd");
    expect(Object.keys(ta)).not.toContain("tenants");
    expect(ta).toEqual({
      kpi: { runs: 2, billable_usd: "0.20" },
      previous: { runs: 1 },
      daily: [{ date: "2026-10-01", runs: 2 }],
      top_features: [{ feature_key: "ke-toan", runs: 2 }],
      top_users: [{ username: "an", runs: 2 }],
    });
    expect(stripCost("platform_admin", report())).toEqual(report());
  });
});
