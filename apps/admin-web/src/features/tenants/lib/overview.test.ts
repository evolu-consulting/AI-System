// CR-112 · tab Tổng quan + quota rút gọn · luật thuần.
import { describe, expect, it } from "bun:test";
import type { QuotaStatus } from "@ai/contracts";
import { buildCards, entitledKeys, type TenantFeature } from "./feature-assign";
import { appsOn, quotaLines, tenantQuotaRow } from "./overview";

const feat = (key: string, entitled: boolean): TenantFeature => ({
  id: key,
  key,
  name: { vi: key, en: key },
  entitled,
});

describe("overview · appsOn", () => {
  it("chỉ liệt kê app đang bật, kèm mức cao nhất, app Tắt và core bị bỏ", () => {
    const features = [
      feat("contracts-read", true),
      feat("contracts-write", true),
      feat("contracts-admin", false),
      feat("knowledge-read", false),
    ];
    const cards = buildCards(features);
    const on = appsOn(cards, entitledKeys(features));
    expect(on.find((a) => a.app === "contracts")?.level).toBe("write");
    expect(on.some((a) => a.app === "knowledge")).toBe(false);
    expect(on.some((a) => a.app === "core")).toBe(false);
  });
});

const row = (over: Partial<QuotaStatus>): QuotaStatus => ({
  feature_id: null,
  feature_key: null,
  feature_name: null,
  max_runs: 100,
  max_tokens: null,
  used: { runs: 40, tokens: 5000 },
  pct: 40,
  level: "none",
  ...over,
});

describe("overview · quota rút gọn", () => {
  it("quotaLines chỉ mang run/token (không có khoá tiền), dòng tenant có key 'tenant'", () => {
    const lines = quotaLines([row({}), row({ feature_id: "f1", feature_key: "k", pct: null })]);
    expect(lines[0]).toEqual({
      key: "tenant",
      featureName: null,
      runs: { used: 40, limit: 100 },
      tokens: { used: 5000, limit: null },
      pct: 40,
      level: "none",
    });
    expect(Object.keys(lines[0] ?? {}).some((k) => k.includes("usd"))).toBe(false);
    expect(lines[1]?.key).toBe("f1");
  });

  it("tenantQuotaRow lấy hàng feature_id null", () => {
    expect(tenantQuotaRow([row({ feature_id: "f1" }), row({})])?.feature_id).toBeNull();
    expect(tenantQuotaRow([])).toBeUndefined();
  });
});
