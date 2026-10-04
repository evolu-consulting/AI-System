// HUB-FR-76 · HUB-H2a-AC-10 · AC-H11 · HUB-BR-19 · H2a-R02, R08 · quyền command Hub (`usableCommands`) = `visible` của
// `computeEffectiveAccess` Admin trên CÙNG bảng ca (test-plan H2a §4 R30–R39, cases §1.4, §7; plan P5, Q4).
// Mỗi ca chạy hai nhánh (`describe.each`): Admin là chuẩn tham chiếu (xanh trước code), Hub đỏ tới B1.
import { describe, expect, it } from "bun:test";
import { computeEffectiveAccess } from "../../../../apps/admin-api/src/modules/access/access.rules";
import {
  type AccessCommand,
  type AccessFeature,
  type CommandAccessInput,
  type UsableCommand,
  usableCommands,
} from "../../../../apps/hub-api/src/modules/commands/command-access.rules";
import { uid } from "./_catalog";

type Impl = (i: CommandAccessInput) => UsableCommand[];

/** Admin: lệnh `visible`; `featureId` = feature hiệu lực (trong `via`) có `key` nhỏ nhất (Q4, quy ước Hub). */
const admin: Impl = (i) => {
  const keyOf = new Map(i.features.map((f) => [f.id, f.key]));
  return computeEffectiveAccess(i)
    .commands.filter((c) => c.visible)
    .map((c) => {
      const keys = c.via.map((v) => ({ id: v.featureId, key: keyOf.get(v.featureId) ?? "" }));
      keys.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return { commandId: c.commandId, featureId: keys[0]?.id ?? "" };
    });
};
const hub: Impl = (i) => usableCommands(i);

const G_STAFF = uid(11);
const G_BETA = uid(12);
const G_OTHER = uid(13);
const X = uid(301);

const user = (groupIds: string[] = [G_STAFF], id = uid(1)) => ({
  id,
  active: true,
  lockedByTenant: false,
  tenantActive: true,
  groupIds,
});
const feat = (o: Partial<AccessFeature> = {}): AccessFeature => ({
  id: uid(201),
  key: "translate",
  status: "on",
  entitled: true,
  grantGroupIds: [G_STAFF],
  grantUser: false,
  ...o,
});
const cmd = (o: Partial<AccessCommand> = {}): AccessCommand => ({
  id: X,
  enabled: true,
  workflowEnabled: true,
  featureIds: [uid(201)],
  ...o,
});
const one = (f: AccessFeature, o: Partial<CommandAccessInput> = {}): CommandAccessInput => ({
  user: user(),
  betaGroupId: G_BETA,
  features: [f],
  commands: [cmd({ featureIds: [f.id] })],
  ...o,
});
const ids = (impl: Impl, i: CommandAccessInput): string[] =>
  impl(i)
    .map((u) => u.commandId)
    .sort();
const sorted = (xs: UsableCommand[]) =>
  [...xs].sort((a, b) => (a.commandId < b.commandId ? -1 : 1));

// ---- Catalog §7 (tenant acme + beta) ----
const F = {
  core: feat({ id: uid(400), key: "core", entitled: false, grantGroupIds: [] }),
  translate: feat({ id: uid(401), key: "translate" }),
  summary: feat({ id: uid(402), key: "summary", entitled: false }),
  labs: feat({ id: uid(403), key: "labs", status: "beta", grantGroupIds: [] }),
  aaa: feat({ id: uid(404), key: "aaa-dup", grantGroupIds: [] }),
};
const C = {
  dich: cmd({ id: uid(501), featureIds: [F.translate.id, F.aaa.id] }),
  tom: cmd({ id: uid(502), featureIds: [F.summary.id] }),
  hoi: cmd({ id: uid(503), featureIds: [F.core.id] }),
  so: cmd({ id: uid(504), featureIds: [F.translate.id, F.labs.id] }),
  tat: cmd({ id: uid(505), workflowEnabled: false, featureIds: [F.translate.id] }),
  dong: cmd({ id: uid(506), enabled: false, featureIds: [F.translate.id] }),
};
const COMMANDS = Object.values(C);
const acme = (u: ReturnType<typeof user>, over: Partial<typeof F>): CommandAccessInput => ({
  user: u,
  betaGroupId: G_BETA,
  features: Object.values({ ...F, ...over }),
  commands: COMMANDS,
});
const FIXTURE: Record<string, CommandAccessInput> = {
  lan: acme(user([G_STAFF, G_BETA], uid(1)), { labs: { ...F.labs, grantUser: true } }),
  hoa: acme(user([G_STAFF], uid(2)), { aaa: { ...F.aaa, grantUser: true } }),
  tadmin: acme(user([], uid(3)), {}),
  an: {
    user: user([uid(21)], uid(4)),
    betaGroupId: uid(22),
    features: [
      F.core,
      { ...F.translate, grantGroupIds: [], grantUser: true },
      F.summary,
      { ...F.labs, entitled: false },
      { ...F.aaa, entitled: false },
    ],
    commands: COMMANDS,
  },
};
const EXPECT: Record<string, UsableCommand[]> = {
  lan: [
    { commandId: C.dich.id, featureId: F.translate.id },
    { commandId: C.hoi.id, featureId: F.core.id },
    { commandId: C.so.id, featureId: F.labs.id },
  ],
  hoa: [
    { commandId: C.dich.id, featureId: F.aaa.id },
    { commandId: C.hoi.id, featureId: F.core.id },
    { commandId: C.so.id, featureId: F.translate.id },
  ],
  tadmin: [{ commandId: C.hoi.id, featureId: F.core.id }],
  an: [
    { commandId: C.dich.id, featureId: F.translate.id },
    { commandId: C.hoi.id, featureId: F.core.id },
    { commandId: C.so.id, featureId: F.translate.id },
  ],
};

describe.each([
  ["Hub", hub],
  ["Admin", admin],
] as const)("HUB-FR-76 · HUB-H2a-AC-10 · %s", (_name, impl) => {
  it("HUB-FR-76 · F on + entitlement + grant group của user → có [R30]", () => {
    expect(ids(impl, one(feat()))).toEqual([X]);
  });

  it("HUB-FR-76 · grant trực tiếp user → có; grant user khác / group không thuộc → không [R31]", () => {
    expect(ids(impl, one(feat({ grantGroupIds: [], grantUser: true })))).toEqual([X]);
    expect(ids(impl, one(feat({ grantGroupIds: [], grantUser: false })))).toEqual([]);
    expect(ids(impl, one(feat({ grantGroupIds: [G_OTHER] })))).toEqual([]);
  });

  it("HUB-FR-76 · AC-H11 · không entitlement → không [R32]", () => {
    expect(ids(impl, one(feat({ entitled: false })))).toEqual([]);
  });

  it("HUB-FR-76 · entitlement thu hồi / của tenant khác (đã giải về entitled=false) → không [R33]", () => {
    const revoked = feat({ entitled: false, grantGroupIds: [G_STAFF], grantUser: true });
    expect(ids(impl, one(revoked))).toEqual([]);
  });

  it("HUB-FR-76 · F off → không [R34]", () => {
    expect(ids(impl, one(feat({ status: "off", grantUser: true })))).toEqual([]);
  });

  it("HUB-FR-76 · F beta: thành viên beta-testers → có; không thuộc → không [R35]", () => {
    const beta = feat({ status: "beta", grantGroupIds: [G_BETA] });
    expect(ids(impl, one(beta, { user: user([G_STAFF, G_BETA]) }))).toEqual([X]);
    const betaUser = feat({ status: "beta", grantGroupIds: [], grantUser: true });
    expect(ids(impl, one(betaUser, { user: user([G_STAFF]) }))).toEqual([]);
  });

  it("HUB-FR-76 · core: không cần entitlement, không cần grant (H2a-R02, M3-R11) [R36]", () => {
    const core = feat({ key: "core", entitled: false });
    expect(ids(impl, one(core))).toEqual([X]);
    expect(ids(impl, one({ ...core, grantGroupIds: [] }))).toEqual([X]);
    expect(ids(impl, one({ ...core, status: "off" }))).toEqual([]);
  });

  it("HUB-FR-76 · HUB-BR-19 · command tắt / workflow tắt → không [R37]", () => {
    const f = feat();
    const base = one(f);
    expect(ids(impl, { ...base, commands: [cmd({ enabled: false })] })).toEqual([]);
    expect(ids(impl, { ...base, commands: [cmd({ workflowEnabled: false })] })).toEqual([]);
    expect(
      ids(impl, { ...base, commands: [cmd(), cmd({ id: uid(302), featureIds: [] })] }),
    ).toEqual([X]);
  });

  it("HUB-FR-76 · H2a-R08 · lệnh ở 2 feature (1 thu hồi) → có; featureId = feature hiệu lực key nhỏ nhất (Q4) [R38]", () => {
    const t = feat({ id: uid(201), key: "translate" });
    const a = feat({ id: uid(202), key: "aaa-dup" });
    const revoked = feat({ id: uid(203), key: "aaa-0", entitled: false });
    const i: CommandAccessInput = {
      user: user(),
      betaGroupId: G_BETA,
      features: [t, revoked, a],
      commands: [cmd({ featureIds: [t.id, revoked.id, a.id] })],
    };
    expect(impl(i)).toEqual([{ commandId: X, featureId: a.id }]);
    const onlyOne = { ...i, commands: [cmd({ featureIds: [revoked.id, t.id] })] };
    expect(impl(onlyOne)).toEqual([{ commandId: X, featureId: t.id }]);
  });

  it("HUB-FR-76 · HUB-H2a-AC-10 · catalog §7: lan, hoa, tadmin, an [R39]", () => {
    for (const [who, input] of Object.entries(FIXTURE)) {
      expect({ who, got: sorted(impl(input)) }).toEqual({ who, got: sorted(EXPECT[who] ?? []) });
    }
  });
});

describe("HUB-FR-76 · HUB-H2a-AC-10 · so tập Hub ↔ Admin", () => {
  it("HUB-FR-76 · HUB-H2a-AC-10 · cùng đầu vào → cùng tập {commandId, featureId} [R39]", () => {
    for (const [who, input] of Object.entries(FIXTURE)) {
      expect({ who, hub: sorted(hub(input)) }).toEqual({ who, hub: sorted(admin(input)) });
    }
  });
});
