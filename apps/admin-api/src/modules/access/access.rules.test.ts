import { describe, expect, test } from "bun:test";
import { type AccessFeature, computeEffectiveAccess } from "./access.rules";

const user = {
  id: "u",
  active: true,
  lockedByTenant: false,
  tenantActive: true,
  groupIds: ["g1", "beta"],
};
const f = (o: Partial<AccessFeature>): AccessFeature => ({
  id: "f",
  key: "kt",
  status: "on",
  entitled: true,
  grantGroupIds: [],
  grantUser: false,
  ...o,
});

describe("ADM-FR-36 · computeEffectiveAccess", () => {
  test("core luôn hiệu lực; beta cần grant + thành viên; reasons giữ khi thiếu entitlement", () => {
    const r = computeEffectiveAccess({
      user,
      betaGroupId: "beta",
      features: [
        f({ id: "c", key: "core", entitled: false }),
        f({ id: "b", status: "beta", grantGroupIds: ["beta"] }),
        f({ id: "x", entitled: false, grantGroupIds: ["g1"] }),
      ],
      commands: [],
    });
    expect(r.features.map((x) => [x.featureId, x.effective, x.missing])).toEqual([
      ["c", true, []],
      ["b", true, []],
      ["x", false, ["no_entitlement"]],
    ]);
    expect(r.features[2]?.reasons).toEqual([{ code: "grant_group", groupId: "g1" }]);
  });

  test("command: blockedBy + gợi ý feature chỉ thiếu grant; user khoá → không gợi ý", () => {
    const input = {
      user,
      betaGroupId: "beta",
      features: [f({ id: "a", entitled: false }), f({ id: "b" })],
      commands: [{ id: "cmd", enabled: true, workflowEnabled: true, featureIds: ["b", "a"] }],
    };
    const c = computeEffectiveAccess(input).commands[0];
    expect(c?.missing).toEqual(["no_effective_feature"]);
    expect(c?.blockedBy.map((x) => x.featureId)).toEqual(["a", "b"]);
    expect(c?.suggestFeatureId).toBe("b");
    const locked = computeEffectiveAccess({ ...input, user: { ...user, active: false } })
      .commands[0];
    expect(locked?.missing).toEqual(["user_inactive"]);
    expect(locked?.suggestFeatureId).toBeNull();
  });
});
