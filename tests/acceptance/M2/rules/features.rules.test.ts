// ADM-FR-30, ADM-FR-31, ADM-FR-33, ADM-FR-34, ADM-BR-10, ADM-BR-12 · luật thuần features (plan.md §4
// `features.rules.ts`; M2-R19…R24). Không DB.
import { describe, expect, it } from "bun:test";
import { loadFeaturesRules } from "../_modules";

const CORE = { key: "core" };
const KT = { key: "ke-toan" };

describe("ADM-FR-30 · core (M2-R20)", () => {
  it("ADM-BR-10 · M2-R20 · CORE_FEATURE_KEY = core; isCore", async () => {
    const r = await loadFeaturesRules();
    expect(r.CORE_FEATURE_KEY).toBe("core");
    expect(r.isCore(CORE)).toBe(true);
    expect(r.isCore(KT)).toBe(false);
  });

  it("ADM-BR-10 · M2-R20 · checkFeatureStatus: core chỉ giữ 'on' (hoặc không đổi); off/beta → CORE_FEATURE_PROTECTED", async () => {
    const r = await loadFeaturesRules();
    expect(r.checkFeatureStatus(CORE, undefined)).toBeNull();
    expect(r.checkFeatureStatus(CORE, "on")).toBeNull();
    expect(r.checkFeatureStatus(CORE, "off")).toMatchObject({ code: "CORE_FEATURE_PROTECTED" });
    expect(r.checkFeatureStatus(CORE, "beta")).toMatchObject({ code: "CORE_FEATURE_PROTECTED" });
  });

  it("ADM-FR-33 · ADM-FR-34 · M2-R24 · checkFeatureStatus: feature thường đổi tự do on/off/beta", async () => {
    const r = await loadFeaturesRules();
    for (const s of ["on", "off", "beta", undefined]) {
      expect(r.checkFeatureStatus(KT, s)).toBeNull();
    }
  });

  it("CR-055 · M2-R21 · checkFeatureDelete: core → CORE_FEATURE_PROTECTED; feature thường → null (kể cả có command độc quyền)", async () => {
    const r = await loadFeaturesRules();
    expect(r.checkFeatureDelete(CORE)).toMatchObject({ code: "CORE_FEATURE_PROTECTED" });
    expect(r.checkFeatureDelete(KT)).toBeNull();
  });
});

describe("ADM-FR-31 · entitlement (M2-R22)", () => {
  it("ADM-FR-31 · M2-R22 · checkEntitlementTarget: core → CORE_FEATURE_PROTECTED; khác → null", async () => {
    const r = await loadFeaturesRules();
    expect(r.checkEntitlementTarget(CORE)).toMatchObject({ code: "CORE_FEATURE_PROTECTED" });
    expect(r.checkEntitlementTarget(KT)).toBeNull();
  });
});

describe("CR-055 · bỏ luật command không mồ côi (M2-R19)", () => {
  it("CR-055 · M2-R19 · không còn luật mồ côi: orphanedByRemoval / membershipError không còn export", async () => {
    const r = await loadFeaturesRules();
    expect(r.orphanedByRemoval).toBeUndefined();
    expect(r.membershipError).toBeUndefined();
  });
});

describe("ADM-FR-24 · hiệu lực & diff (M2-R23)", () => {
  it("ADM-FR-24 · M2-R23 · isFeatureEffective: on, beta → true; off → false", async () => {
    const r = await loadFeaturesRules();
    expect(r.isFeatureEffective("on")).toBe(true);
    expect(r.isFeatureEffective("beta")).toBe(true);
    expect(r.isFeatureEffective("off")).toBe(false);
  });

  it("ADM-FR-30 · M2-R25 · diffIds: thêm/bớt sắp tăng dần, không sinh trùng", async () => {
    const r = await loadFeaturesRules();
    expect(r.diffIds(["b", "a", "d"], ["d", "c", "e", "c"])).toEqual({
      added: ["c", "e"],
      removed: ["a", "b"],
    });
    expect(r.diffIds(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] });
  });
});

describe("ADM-FR-30 · changedFeatureFields (M2-R25)", () => {
  const cur = {
    name: { vi: "Kế toán" },
    description: {},
    icon: "package",
    status: "on",
    commandIds: ["a", "b"],
  };

  it("ADM-FR-30 · M2-R25 · giống hệt; commandIds cùng tập khác thứ tự → []", async () => {
    const r = await loadFeaturesRules();
    expect(r.changedFeatureFields(cur, { ...cur })).toEqual([]);
    expect(r.changedFeatureFields(cur, { ...cur, commandIds: ["b", "a"] })).toEqual([]);
  });

  it("ADM-FR-30 · M2-R25 · mỗi trường đổi → đúng khoá; name {vi} ↔ {vi,en} là đổi", async () => {
    const r = await loadFeaturesRules();
    expect(
      r.changedFeatureFields(cur, { ...cur, name: { vi: "Kế toán", en: "Accounting" } }),
    ).toEqual(["name"]);
    expect(r.changedFeatureFields(cur, { ...cur, icon: "calculator" })).toEqual(["icon"]);
    expect(r.changedFeatureFields(cur, { ...cur, status: "off" })).toEqual(["status"]);
    expect(r.changedFeatureFields(cur, { ...cur, commandIds: ["a"] })).toEqual(["commandIds"]);
    expect(r.changedFeatureFields(cur, { ...cur, description: { vi: "Mô tả" } })).toEqual([
      "description",
    ]);
  });
});
