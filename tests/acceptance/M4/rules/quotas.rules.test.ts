// ADM-FR-40, ADM-FR-41 · M4-R01–R06 · hàm thuần `modules/quotas/quotas.rules.ts` (test-plan R1–R8; chữ ký plan-rules §A4).
// Xanh ở T3. Module nạp động (`_modules.ts`): trước T3 mỗi ca đỏ vì "Cannot find module".
import { describe, expect, it } from "bun:test";
import { loadQuotasRules } from "../_modules";

const Q = () => loadQuotasRules();
const F1 = "01900000-0000-7000-8000-000000000431";
const F2 = "01900000-0000-7000-8000-000000000432";
const d = (iso: string) => new Date(iso);

type Lim = { maxRuns?: number | null; maxTokens?: number | null; maxUsd?: string | null };
const lim = (l: Lim) => ({ maxRuns: null, maxTokens: null, maxUsd: null, ...l });
const use = (u: {
  runs?: number;
  tokens?: number;
  billableUsd?: string;
  unpricedRows?: number;
}) => ({
  runs: 0,
  tokens: 0,
  billableUsd: "0",
  unpricedRows: 0,
  ...u,
});
const ev = (featureId: string | null, pct: number | null, level: string) => ({
  featureId,
  pct,
  level,
  used: use({}),
});
const item = (feature_id: string | null, l: Record<string, unknown> = {}) => ({
  feature_id,
  max_runs: null,
  max_tokens: null,
  max_usd: null,
  ...l,
});

describe("ADM-FR-40 · M4-R01 · monthRange (tháng theo giờ VN)", () => {
  it("ADM-FR-40 · M4-R01 · 2026-09-30T16:59:59Z (23:59:59 VN) → 2026-09; T17:00:00Z → 2026-10, from 09-30T17:00Z, to 10-31T17:00Z", async () => {
    const { monthRange, QUOTA_TZ_OFFSET_MIN } = await Q();
    expect(QUOTA_TZ_OFFSET_MIN).toBe(420);
    expect(monthRange(d("2026-09-30T16:59:59Z")).month).toBe("2026-09");
    const r = monthRange(d("2026-09-30T17:00:00Z"));
    expect(r.month).toBe("2026-10");
    expect((r.from as Date).toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect((r.to as Date).toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("ADM-FR-40 · M4-R01 · tháng 12 → to là 01/01 năm sau (VN); 2026-12-31T17:00Z đã là 2027-01", async () => {
    const { monthRange } = await Q();
    const r = monthRange(d("2026-12-15T03:00:00Z"));
    expect(r.month).toBe("2026-12");
    expect((r.from as Date).toISOString()).toBe("2026-11-30T17:00:00.000Z");
    expect((r.to as Date).toISOString()).toBe("2026-12-31T17:00:00.000Z");
    expect(monthRange(d("2026-12-31T17:00:00Z")).month).toBe("2027-01");
  });
});

describe("ADM-FR-41 · M4-R03 · quotaPct / quotaLevel", () => {
  it("ADM-FR-41 · M4-R03 · run 800/1000 → 80; 999 → 99 (floor); 1001 → 100", async () => {
    const { quotaPct } = await Q();
    const l = lim({ maxRuns: 1000 });
    expect(quotaPct(l, use({ runs: 800 }))).toBe(80);
    expect(quotaPct(l, use({ runs: 999 }))).toBe(99);
    expect(quotaPct(l, use({ runs: 1001 }))).toBe(100);
  });

  it("ADM-FR-41 · M4-R03 · USD chuỗi: 212.40/300.00 → 70; 0.29/0.30 → 96; 0.57/1.00 → 57; 1.15/1.00 → 115 (không lỗi float)", async () => {
    const { quotaPct } = await Q();
    expect(quotaPct(lim({ maxUsd: "300.00" }), use({ billableUsd: "212.40" }))).toBe(70);
    expect(quotaPct(lim({ maxUsd: "0.30" }), use({ billableUsd: "0.29" }))).toBe(96);
    expect(quotaPct(lim({ maxUsd: "1.00" }), use({ billableUsd: "0.57" }))).toBe(57);
    expect(quotaPct(lim({ maxUsd: "1.00" }), use({ billableUsd: "1.15" }))).toBe(115);
  });

  it("ADM-FR-41 · M4-R03 · nhiều chiều lấy max (run 50% + token 90% → 90); không chiều nào giới hạn → null", async () => {
    const { quotaPct } = await Q();
    expect(
      quotaPct(lim({ maxRuns: 1000, maxTokens: 10000 }), use({ runs: 500, tokens: 9000 })),
    ).toBe(90);
    expect(quotaPct(lim({}), use({ runs: 5000, tokens: 1, billableUsd: "9.00" }))).toBeNull();
  });

  it("ADM-FR-41 · M4-R04 · quotaLevel: null/0/79 → none; 80/99 → warn; 100/250 → over", async () => {
    const { quotaLevel } = await Q();
    expect([null, 0, 79].map((p) => quotaLevel(p))).toEqual(["none", "none", "none"]);
    expect([80, 99].map((p) => quotaLevel(p))).toEqual(["warn", "warn"]);
    expect([100, 250].map((p) => quotaLevel(p))).toEqual(["over", "over"]);
  });
});

describe("ADM-FR-41 · M4-R03 · evaluateQuota", () => {
  it("ADM-FR-41 · M4-R03 · quota feature dùng byFeature (thiếu key = 0 → pct 0, none); quota null dùng total; giữ thứ tự đầu vào", async () => {
    const { evaluateQuota } = await Q();
    const out = evaluateQuota({
      quotas: [
        { featureId: F2, ...lim({ maxRuns: 10 }) },
        { featureId: null, ...lim({ maxRuns: 1000 }) },
        { featureId: F1, ...lim({ maxRuns: 100 }) },
      ],
      total: use({ runs: 900, tokens: 135000 }),
      byFeature: new Map([[F1, use({ runs: 85 })]]),
    }) as Array<{
      featureId: string | null;
      pct: number | null;
      level: string;
      used: Record<string, unknown>;
    }>;
    expect(out.map((e) => [e.featureId, e.pct, e.level])).toEqual([
      [F2, 0, "none"],
      [null, 90, "warn"],
      [F1, 85, "warn"],
    ]);
    expect(out[0]?.used).toMatchObject({ runs: 0, tokens: 0, unpricedRows: 0 });
    expect(Number(out[0]?.used.billableUsd)).toBe(0);
    expect(out[1]?.used).toMatchObject({ runs: 900, tokens: 135000 });
    expect(out[2]?.used).toMatchObject({ runs: 85 });
  });
});

describe("ADM-FR-41 · M4-R04 · alertsDue", () => {
  type Due = { featureId: string | null; level: number; pct: number; status: string };
  const key = (a: Due[]) => a.map((x) => `${x.featureId ?? "null"}:${x.level}:${x.status}`).sort();

  it("ADM-FR-41 · M4-R04 · warn 85 chưa có gì → [80 pending pct 85]", async () => {
    const { alertsDue } = await Q();
    expect(alertsDue([ev(null, 85, "warn")], [])).toEqual([
      { featureId: null, level: 80, pct: 85, status: "pending" },
    ]);
  });

  it("ADM-FR-41 · M4-R04 · over mới (chưa có 80) → 100 pending + 80 skipped (không gửi 80 sau 100)", async () => {
    const { alertsDue } = await Q();
    const out = alertsDue([ev(null, 120, "over")], []) as Due[];
    expect(key(out)).toEqual(["null:100:pending", "null:80:skipped"]);
    expect(out.find((x) => x.level === 100)?.pct).toBe(120);
  });

  it("ADM-FR-41 · M4-R04 · over khi đã có 80 → chỉ 100; đã có 100 → []; level none → []", async () => {
    const { alertsDue } = await Q();
    const had80 = [{ featureId: null, level: 80 }];
    expect(key(alertsDue([ev(null, 101, "over")], had80) as Due[])).toEqual(["null:100:pending"]);
    expect(alertsDue([ev(null, 130, "over")], [...had80, { featureId: null, level: 100 }])).toEqual(
      [],
    );
    expect(alertsDue([ev(null, 50, "none")], [])).toEqual([]);
    expect(alertsDue([ev(null, null, "none")], [])).toEqual([]);
  });

  it("ADM-FR-41 · M4-R04 · tách theo featureId: 80 của F1 đã có không chặn 80 của cả tenant", async () => {
    const { alertsDue } = await Q();
    const out = alertsDue(
      [ev(null, 85, "warn"), ev(F1, 90, "warn")],
      [{ featureId: F1, level: 80 }],
    ) as Due[];
    expect(key(out)).toEqual(["null:80:pending"]);
  });
});

describe("ADM-FR-41 · M4-R06 · bannerFor", () => {
  it("ADM-FR-41 · M4-R06 · platform_admin / member → null dù đang vượt", async () => {
    const { bannerFor } = await Q();
    const evals = [ev(null, 120, "over")];
    expect(bannerFor("platform_admin", evals)).toBeNull();
    expect(bannerFor("member", evals)).toBeNull();
  });

  it("ADM-FR-41 · M4-R06 · tenant_admin không quota / mọi quota none → null", async () => {
    const { bannerFor } = await Q();
    expect(bannerFor("tenant_admin", [])).toBeNull();
    expect(bannerFor("tenant_admin", [ev(null, 79, "none"), ev(F1, null, "none")])).toBeNull();
  });

  it("ADM-FR-41 · M4-R06 · chọn pct lớn nhất; bằng nhau → featureId null trước", async () => {
    const { bannerFor } = await Q();
    expect(bannerFor("tenant_admin", [ev(null, 85, "warn"), ev(F1, 120, "over")])).toEqual({
      level: "over",
      pct: 120,
      featureId: F1,
    });
    expect(bannerFor("tenant_admin", [ev(F1, 85, "warn"), ev(null, 85, "warn")])).toEqual({
      level: "warn",
      pct: 85,
      featureId: null,
    });
  });
});

describe("ADM-FR-40 · M4-R02 · normalizeQuotaItems / duplicateFeatureIndex", () => {
  it("ADM-FR-40 · M4-R02 · bỏ dòng cả 3 giới hạn null, giữ các dòng còn lại", async () => {
    const { normalizeQuotaItems } = await Q();
    const out = normalizeQuotaItems([
      item(null, { max_runs: 1000 }),
      item(F1),
      item(F2, { max_usd: "300.00" }),
    ]) as Array<{ feature_id: string | null }>;
    expect(out.map((x) => x.feature_id).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
      [F2, null].sort((a, b) => String(a).localeCompare(String(b))),
    );
    expect(out).toHaveLength(2);
  });

  it("ADM-FR-40 · M4-R02 · duplicateFeatureIndex: hai null → 1; uuid trùng → index dòng sau; không trùng → null", async () => {
    const { duplicateFeatureIndex } = await Q();
    expect(duplicateFeatureIndex([item(null, { max_runs: 1 }), item(null, { max_runs: 2 })])).toBe(
      1,
    );
    expect(
      duplicateFeatureIndex([
        item(F1, { max_runs: 1 }),
        item(F2, { max_runs: 1 }),
        item(F1, { max_runs: 2 }),
      ]),
    ).toBe(2);
    expect(
      duplicateFeatureIndex([item(null, { max_runs: 1 }), item(F1, { max_runs: 1 })]),
    ).toBeNull();
  });
});

describe("ADM-FR-41 · M4-R05 · alertMail", () => {
  const link = "http://localhost:3000/usage";

  it("ADM-FR-41 · M4-R05 · vi: '[ACME] Đã dùng 80% quota tháng'; en: '[ACME] 80% of monthly quota used'; text có link", async () => {
    const { alertMail } = await Q();
    const vi = alertMail({ tenantName: "ACME", pct: 80, locale: "vi", link });
    const en = alertMail({ tenantName: "ACME", pct: 80, locale: "en", link });
    expect(vi.subject).toBe("[ACME] Đã dùng 80% quota tháng");
    expect(en.subject).toBe("[ACME] 80% of monthly quota used");
    expect(vi.text).toContain(link);
    expect(en.text).toContain(link);
  });

  it("ADM-FR-41 · M4-R05 · thư không chứa địa chỉ email nào (không lộ người nhận)", async () => {
    const { alertMail } = await Q();
    for (const locale of ["vi", "en"] as const) {
      const m = alertMail({ tenantName: "ACME", pct: 100, locale, link });
      expect(`${m.subject}\n${m.text}`).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    }
  });
});
