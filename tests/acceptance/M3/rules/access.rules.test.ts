// ADM-FR-36, ADM-BR-11, ADM-BR-12 · computeEffectiveAccess (plan.md §4 `access.rules.ts`; M3-R11, R12; test-plan R5).
// Bảng sự thật theo luật plan §4 (blockers, core, on/off/beta, reasons/missing, command, suggestion). Không DB.
import { describe, expect, it } from "bun:test";
import { loadAccessRules } from "../_modules";

type Loose = Record<string, unknown>;
const BETA = "g-beta";
const GA = "g-a";
const GB = "g-b";
const USER = {
  id: "u-1",
  active: true,
  lockedByTenant: false,
  tenantActive: true,
  groupIds: [] as string[],
};

const feat = (over: Loose = {}) => ({
  id: "f-1",
  key: "ke-toan",
  status: "on",
  entitled: true,
  grantGroupIds: [] as string[],
  grantUser: false,
  ...over,
});
const cmd = (over: Loose = {}) => ({
  id: "c-1",
  enabled: true,
  workflowEnabled: true,
  featureIds: ["f-1"],
  ...over,
});
type In = { user?: Loose; betaGroupId?: string | null; features?: unknown[]; commands?: unknown[] };
const mk = (o: In = {}) => ({
  user: { ...USER, ...(o.user ?? {}) },
  betaGroupId: o.betaGroupId === undefined ? BETA : o.betaGroupId,
  features: o.features ?? [],
  commands: o.commands ?? [],
});
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    for (const v of Object.values(o as object)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
};
const one = async (o: In) => {
  const r = await loadAccessRules();
  return r.computeEffectiveAccess(deepFreeze(mk(o)));
};
const f0 = async (o: In) => (await one(o)).features[0];
const c0 = async (o: In) => (await one(o)).commands[0];

describe("ADM-FR-36 · blockers (M3-R11)", () => {
  it("ADM-FR-36 · M3-R11 · user active + tenant active, không khoá → blockers []", async () => {
    expect((await one({})).blockers).toEqual([]);
  });

  it("ADM-FR-36 · M3-R11 · !active → [user_inactive]", async () => {
    expect((await one({ user: { active: false } })).blockers).toEqual(["user_inactive"]);
  });

  it("ADM-FR-36 · M3-R11 · lockedByTenant → [tenant_locked]; !tenantActive → [tenant_locked]", async () => {
    expect((await one({ user: { lockedByTenant: true } })).blockers).toEqual(["tenant_locked"]);
    expect((await one({ user: { tenantActive: false } })).blockers).toEqual(["tenant_locked"]);
    expect((await one({ user: { lockedByTenant: true, tenantActive: false } })).blockers).toEqual([
      "tenant_locked",
    ]);
  });

  it("ADM-FR-36 · M3-R11 · cả hai blocker → đúng thứ tự [user_inactive, tenant_locked]", async () => {
    const a = await one({ user: { active: false, lockedByTenant: true } });
    expect(a.blockers).toEqual(["user_inactive", "tenant_locked"]);
  });

  it("ADM-FR-36 · M3-R11 · có blocker → feature missing bắt đầu bằng blocker; command không visible, missing bắt đầu bằng blocker và KHÔNG có no_effective_feature", async () => {
    const a = await one({
      user: { active: false, groupIds: [GA] },
      features: [feat({ grantGroupIds: [GA] })],
      commands: [cmd()],
    });
    expect(a.features[0].effective).toBe(false);
    expect(a.features[0].missing).toEqual(["user_inactive"]);
    expect(a.commands[0].visible).toBe(false);
    expect(a.commands[0].missing).toEqual(["user_inactive"]);
    expect(a.commands[0].blockedBy).toEqual([{ featureId: "f-1", missing: [] }]);
  });
});

describe("ADM-FR-36 · core (M3-R11)", () => {
  const core = (over: Loose = {}) => feat({ id: "f-core", key: "core", entitled: false, ...over });

  it("ADM-FR-36 · M3-R11 · core: reasons [core], hiệu lực không cần entitlement/grant", async () => {
    const f = await f0({ features: [core()] });
    expect(f).toMatchObject({
      featureId: "f-core",
      effective: true,
      reasons: [{ code: "core" }],
      missing: [],
    });
  });

  it("ADM-FR-36 · M3-R11 · core với entitled=false vẫn hiệu lực; grant thừa không đổi reasons", async () => {
    const f = await f0({
      user: { groupIds: [GA] },
      features: [core({ grantGroupIds: [GA], grantUser: true })],
    });
    expect(f.effective).toBe(true);
    expect(f.reasons).toEqual([{ code: "core" }]);
  });

  it("ADM-FR-36 · M3-R11 · core nhưng user có blocker → effective false, reasons vẫn [core]", async () => {
    const f = await f0({ user: { active: false }, features: [core()] });
    expect(f.effective).toBe(false);
    expect(f.reasons).toEqual([{ code: "core" }]);
    expect(f.missing).toEqual(["user_inactive"]);
  });
});

describe("ADM-FR-36 · feature thường status on (M3-R11, BR-12)", () => {
  it("ADM-FR-36 · M3-R11 · entitled + grant group (user thuộc group) → effective, reasons [grant_group]", async () => {
    const f = await f0({ user: { groupIds: [GA] }, features: [feat({ grantGroupIds: [GA] })] });
    expect(f.effective).toBe(true);
    expect(f.reasons).toEqual([{ code: "grant_group", groupId: GA }]);
    expect(f.missing).toEqual([]);
  });

  it("ADM-FR-36 · M3-R11 · entitled + grantUser → [grant_user]; cả hai → grant_user TRƯỚC grant_group", async () => {
    const u = await f0({ features: [feat({ grantUser: true })] });
    expect(u.reasons).toEqual([{ code: "grant_user" }]);
    const both = await f0({
      user: { groupIds: [GA] },
      features: [feat({ grantUser: true, grantGroupIds: [GA] })],
    });
    expect(both.reasons).toEqual([{ code: "grant_user" }, { code: "grant_group", groupId: GA }]);
  });

  it("ADM-FR-36 · M3-R11 · group được cấp nhưng user KHÔNG thuộc → missing [no_grant], reasons rỗng", async () => {
    const f = await f0({ user: { groupIds: [GB] }, features: [feat({ grantGroupIds: [GA] })] });
    expect(f.effective).toBe(false);
    expect(f.missing).toEqual(["no_grant"]);
    expect(f.reasons).toEqual([]);
  });

  it("ADM-FR-36 · M3-R11 · entitled không grant → [no_grant]", async () => {
    expect((await f0({ features: [feat()] })).missing).toEqual(["no_grant"]);
  });

  it("ADM-BR-12 · M3-R11 · ¬entitled + có grant → effective false, reasons GIỮ grant_group, missing [no_entitlement] (A11)", async () => {
    const f = await f0({
      user: { groupIds: [GA] },
      features: [feat({ entitled: false, grantGroupIds: [GA] })],
    });
    expect(f.effective).toBe(false);
    expect(f.reasons).toEqual([{ code: "grant_group", groupId: GA }]);
    expect(f.missing).toEqual(["no_entitlement"]);
  });

  it("ADM-FR-36 · M3-R11 · ¬entitled + không grant → [no_entitlement, no_grant] đúng thứ tự", async () => {
    expect((await f0({ features: [feat({ entitled: false })] })).missing).toEqual([
      "no_entitlement",
      "no_grant",
    ]);
  });
});

describe("ADM-FR-34 · feature off / beta (M3-R11, A7)", () => {
  it("ADM-FR-33 · M3-R11 · off: missing có feature_off ngay sau blockers; entitled + grant vẫn không hiệu lực, reasons giữ", async () => {
    const f = await f0({
      user: { groupIds: [GA] },
      features: [feat({ status: "off", grantGroupIds: [GA] })],
    });
    expect(f.effective).toBe(false);
    expect(f.missing).toEqual(["feature_off"]);
    expect(f.reasons).toEqual([{ code: "grant_group", groupId: GA }]);
  });

  it("ADM-FR-33 · M3-R11 · off + không grant + ¬entitled → [feature_off, no_entitlement, no_grant]", async () => {
    const f = await f0({ features: [feat({ status: "off", entitled: false })] });
    expect(f.missing).toEqual(["feature_off", "no_entitlement", "no_grant"]);
  });

  it("ADM-FR-34 · M3-R11 · beta: có grant (qua beta group) VÀ là thành viên → effective, reasons [grant_group beta, beta_member]", async () => {
    const f = await f0({
      user: { groupIds: [BETA] },
      features: [feat({ status: "beta", grantGroupIds: [BETA] })],
    });
    expect(f.effective).toBe(true);
    expect(f.reasons).toEqual([{ code: "grant_group", groupId: BETA }, { code: "beta_member" }]);
  });

  it("ADM-FR-34 · M3-R11 · beta: thành viên nhưng không grant → missing [no_grant], reasons [beta_member]", async () => {
    const f = await f0({ user: { groupIds: [BETA] }, features: [feat({ status: "beta" })] });
    expect(f.missing).toEqual(["no_grant"]);
    expect(f.reasons).toEqual([{ code: "beta_member" }]);
  });

  it("ADM-FR-34 · M3-R11 · beta: có grant nhưng không thành viên → [beta_not_member], reasons [grant_group]", async () => {
    const f = await f0({
      user: { groupIds: [GA] },
      features: [feat({ status: "beta", grantGroupIds: [GA] })],
    });
    expect(f.missing).toEqual(["beta_not_member"]);
    expect(f.reasons).toEqual([{ code: "grant_group", groupId: GA }]);
  });

  it("ADM-FR-34 · M3-R11 · beta: không grant, không thành viên → [beta_not_member, no_grant]; betaGroupId=null → beta_not_member", async () => {
    expect((await f0({ features: [feat({ status: "beta" })] })).missing).toEqual([
      "beta_not_member",
      "no_grant",
    ]);
    const n = await f0({
      betaGroupId: null,
      user: { groupIds: [BETA] },
      features: [feat({ status: "beta", grantUser: true })],
    });
    expect(n.missing).toEqual(["beta_not_member"]);
  });

  it("ADM-FR-34 · M3-R11 · beta + ¬entitled: thứ tự beta_not_member, no_entitlement, no_grant; grant qua group thường vẫn cần thành viên beta", async () => {
    const f = await f0({ features: [feat({ status: "beta", entitled: false })] });
    expect(f.missing).toEqual(["beta_not_member", "no_entitlement", "no_grant"]);
    const g = await f0({
      user: { groupIds: [GA] },
      features: [feat({ status: "beta", grantGroupIds: [GA] })],
    });
    expect(g.effective).toBe(false);
  });
});

describe("ADM-FR-36 · reasons theo nhiều group (M3-R12)", () => {
  it("ADM-FR-36 · M3-R12 · nhiều grantGroupIds giao groupIds → theo thứ tự của grantGroupIds (không theo groupIds)", async () => {
    const f = await f0({
      user: { groupIds: [GB, GA] },
      features: [feat({ grantGroupIds: [GA, GB] })],
    });
    expect(f.reasons).toEqual([
      { code: "grant_group", groupId: GA },
      { code: "grant_group", groupId: GB },
    ]);
  });

  it("ADM-FR-36 · M3-R12 · group được cấp mà user không thuộc → không nằm trong reasons", async () => {
    const f = await f0({
      user: { groupIds: [GB] },
      features: [feat({ grantGroupIds: [GA, GB] })],
    });
    expect(f.reasons).toEqual([{ code: "grant_group", groupId: GB }]);
  });
});

describe("ADM-FR-36 · command (M3-R11, R12)", () => {
  const ok = { user: { groupIds: [GA] }, features: [feat({ grantGroupIds: [GA] })] };

  it("ADM-FR-36 · M3-R11 · thấy qua feature hiệu lực: visible, via kèm reasons, blockedBy rỗng", async () => {
    const c = await c0({ ...ok, commands: [cmd()] });
    expect(c.visible).toBe(true);
    expect(c.missing).toEqual([]);
    expect(c.via).toEqual([{ featureId: "f-1", reasons: [{ code: "grant_group", groupId: GA }] }]);
    expect(c.blockedBy).toEqual([]);
    expect(c.suggestFeatureId).toBeNull();
  });

  it("ADM-FR-36 · M3-R11 · enabled=false → missing [command_disabled] (có via nên không no_effective_feature)", async () => {
    const c = await c0({ ...ok, commands: [cmd({ enabled: false })] });
    expect(c.visible).toBe(false);
    expect(c.missing).toEqual(["command_disabled"]);
  });

  it("ADM-FR-36 · M3-R11 · workflowEnabled=false → workflow_disabled; cả hai tắt → [command_disabled, workflow_disabled]", async () => {
    expect((await c0({ ...ok, commands: [cmd({ workflowEnabled: false })] })).missing).toEqual([
      "workflow_disabled",
    ]);
    expect(
      (await c0({ ...ok, commands: [cmd({ enabled: false, workflowEnabled: false })] })).missing,
    ).toEqual(["command_disabled", "workflow_disabled"]);
  });

  it("ADM-FR-36 · M3-R11 · via rỗng và không blocker → no_effective_feature; tắt + không via → [command_disabled, no_effective_feature]", async () => {
    const none = await c0({ features: [feat()], commands: [cmd()] });
    expect(none.missing).toEqual(["no_effective_feature"]);
    const off = await c0({ features: [feat()], commands: [cmd({ enabled: false })] });
    expect(off.missing).toEqual(["command_disabled", "no_effective_feature"]);
  });

  it("ADM-FR-36 · M3-R12 · blockedBy = feature của command KHÔNG hiệu lực, missing đã bỏ user_inactive/tenant_locked; thứ tự theo features input", async () => {
    const c = await c0({
      user: { groupIds: [GA] },
      features: [
        feat({ id: "f-2", key: "b", entitled: false, grantGroupIds: [GA] }),
        feat({ id: "f-1", key: "a" }),
        feat({ id: "f-3", key: "c", grantGroupIds: [GA] }),
      ],
      commands: [cmd({ featureIds: ["f-1", "f-2", "f-3"] })],
    });
    expect(c.visible).toBe(true);
    expect(c.via.map((v: Loose) => v.featureId)).toEqual(["f-3"]);
    expect(c.blockedBy).toEqual([
      { featureId: "f-2", missing: ["no_entitlement"] },
      { featureId: "f-1", missing: ["no_grant"] },
    ]);
  });

  it("ADM-FR-36 · M3-R12 · featureIds rỗng → [no_effective_feature]; featureIds trỏ id không có trong features → bỏ qua, không ném", async () => {
    expect((await c0({ features: [feat()], commands: [cmd({ featureIds: [] })] })).missing).toEqual(
      ["no_effective_feature"],
    );
    const c = await c0({ features: [feat()], commands: [cmd({ featureIds: ["f-zzz", "f-1"] })] });
    expect(c.blockedBy.map((b: Loose) => b.featureId)).toEqual(["f-1"]);
  });

  it("ADM-FR-36 · M3-R11 · thứ tự command giữ như input; mỗi command tính độc lập", async () => {
    const a = await one({
      ...ok,
      commands: [cmd({ id: "c-9" }), cmd({ id: "c-2", enabled: false }), cmd({ id: "c-5" })],
    });
    expect(a.commands.map((c: Loose) => [c.commandId, c.visible])).toEqual([
      ["c-9", true],
      ["c-2", false],
      ["c-5", true],
    ]);
  });
});

describe("ADM-FR-36 · suggestFeatureId (F4 'Cấp cho group…')", () => {
  it("ADM-FR-36 · M3-R12 · không thấy, không blocker, command bật: gợi ý feature ĐẦU TIÊN có missing đúng ['no_grant']", async () => {
    const c = await c0({
      features: [
        feat({ id: "f-1", key: "a", entitled: false }),
        feat({ id: "f-2", key: "b" }),
        feat({ id: "f-3", key: "c" }),
      ],
      commands: [cmd({ featureIds: ["f-1", "f-2", "f-3"] })],
    });
    expect(c.suggestFeatureId).toBe("f-2");
  });

  it("ADM-FR-36 · M3-R12 · feature chỉ có [no_entitlement, no_grant] → không gợi ý (null)", async () => {
    const c = await c0({ features: [feat({ entitled: false })], commands: [cmd()] });
    expect(c.suggestFeatureId).toBeNull();
  });

  it("ADM-FR-36 · M3-R12 · command bị tắt hoặc workflow tắt → null", async () => {
    const f = [feat()];
    expect(
      (await c0({ features: f, commands: [cmd({ enabled: false })] })).suggestFeatureId,
    ).toBeNull();
    expect(
      (await c0({ features: f, commands: [cmd({ workflowEnabled: false })] })).suggestFeatureId,
    ).toBeNull();
  });

  it("ADM-FR-36 · M3-R12 · có blockers → null", async () => {
    const c = await c0({ user: { active: false }, features: [feat()], commands: [cmd()] });
    expect(c.suggestFeatureId).toBeNull();
  });
});

describe("ADM-FR-36 · tổng hợp", () => {
  it("ADM-FR-36 · input rỗng → {blockers: [], features: [], commands: []}", async () => {
    expect(await one({})).toEqual({ blockers: [], features: [], commands: [] });
  });

  it("ADM-FR-36 · thuần: gọi hai lần cùng input cho kết quả toEqual; features giữ thứ tự input", async () => {
    const input = mk({
      user: { groupIds: [GA] },
      features: [feat({ id: "f-9", key: "z" }), feat({ id: "f-1", key: "a", grantGroupIds: [GA] })],
      commands: [cmd({ featureIds: ["f-9", "f-1"] })],
    });
    const r = await loadAccessRules();
    const a = r.computeEffectiveAccess(input);
    const b = r.computeEffectiveAccess(input);
    expect(a).toEqual(b);
    expect(a.features.map((f: Loose) => f.featureId)).toEqual(["f-9", "f-1"]);
  });
});
