import { describe, expect, test } from "bun:test";
import {
  changedFeatureFields,
  checkEntitlementTarget,
  checkFeatureDelete,
  checkFeatureStatus,
  diffIds,
  isFeatureEffective,
  membershipError,
  orphanedByRemoval,
} from "./features.rules";

const CORE = { key: "core" };
const F = { key: "docs" };

describe("ADM-FR-30 · features.rules", () => {
  test("ADM-BR-10 · core chỉ giữ on; xoá/entitlement core bị chặn", () => {
    expect(checkFeatureStatus(CORE, "beta")?.code).toBe("CORE_FEATURE_PROTECTED");
    expect(checkFeatureStatus(F, "off")).toBeNull();
    expect(checkFeatureDelete(CORE, [])?.code).toBe("CORE_FEATURE_PROTECTED");
    expect(checkFeatureDelete(F, [{ id: "c", name: "x" }])?.code).toBe(
      "FEATURE_HAS_EXCLUSIVE_COMMANDS",
    );
    expect(checkEntitlementTarget(CORE)?.code).toBe("CORE_FEATURE_PROTECTED");
  });

  test("ADM-BR-10 · mồ côi khi featureCount ≤ 1", () => {
    const o = orphanedByRemoval([
      { id: "a", name: "a", featureCount: 1 },
      { id: "b", name: "b", featureCount: 3 },
    ]);
    expect(o).toEqual([{ id: "a", name: "a" }]);
    expect(membershipError(o)?.details).toEqual({ commands: o });
  });

  test("ADM-FR-34 · hiệu lực + diff + changed", () => {
    expect(isFeatureEffective("beta")).toBe(true);
    expect(diffIds(["a"], ["b", "a"])).toEqual({ added: ["b"], removed: [] });
    const s = {
      name: { vi: "x" },
      description: {},
      icon: "i",
      status: "on" as const,
      commandIds: [],
    };
    expect(changedFeatureFields(s, { ...s, description: { en: "y" } })).toEqual(["description"]);
  });
});
