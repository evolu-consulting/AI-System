// CR-112 · ADM-FR-78 · kế hoạch lưu tab "Ứng dụng & Gói": mức ⇒ gói + entitlement, thứ tự bật gói → cấp/thu hồi → tắt gói, lỗi từng phần.
import { describe, expect, test } from "bun:test";
import { appOfKey } from "@/features/features/lib/feature-fixtures";
import { appsConfirmMessage, needsConfirm } from "./apps-confirm";
import {
  type AppsPlan,
  derivePacks,
  nextIntent,
  type PackInfo,
  PlanError,
  type PlanIO,
  packOf,
  planChanges,
  roleStats,
  runPlan,
} from "./apps-plan";
import {
  type AppCard,
  buildCards,
  detectLevel,
  entitledKeys,
  setKey,
  setLevel,
  type TenantFeature,
} from "./feature-assign";

const KEYS = [
  "core",
  "chat-app",
  "contracts-read",
  "contracts-write",
  "contracts-admin",
  "han-muc-duyet",
];
const feats = (on: string[] = []): TenantFeature[] =>
  KEYS.map((k) => ({
    id: `id-${k}`,
    key: k,
    name: { vi: k },
    app: appOfKey(k),
    entitled: k === "core" || on.includes(k),
  }));
const pack = (enabled: boolean, extra: Partial<PackInfo> = {}): PackInfo => ({
  key: "contracts",
  enabled,
  ...extra,
});
const keys = (fs: TenantFeature[]) => fs.map((f) => f.key).sort();

/** Mô phỏng thao tác người dùng: chọn mức cho app contracts (đúng như hook `changeLevel`). */
function pick(on: string[], packs: PackInfo[], level: Parameters<typeof setLevel>[2]) {
  const f = feats(on);
  const cards = buildCards(f);
  const card = cards.find((c) => c.app === "contracts") as AppCard;
  const current = entitledKeys(f);
  const draft = setLevel(current, card, level);
  const intent = nextIntent({}, "contracts", level, detectLevel(card, current).level);
  return { f, cards, draft, intent, plan: planChanges(f, cards, packs, draft, intent) };
}

describe("derivePacks · tenant_admin không gọi GET packs", () => {
  test("bật ⇔ có entitlement Xem; số vai/người từ danh sách vai", () => {
    const cards = buildCards(feats(["contracts-read"]));
    const roles = [
      { pack: "contracts", member_count: 2 },
      { pack: "contracts", member_count: 1 },
      { pack: "community", member_count: 5 },
    ];
    expect(derivePacks(cards, roles)).toEqual([
      { key: "contracts", enabled: true, role_count: 2, member_count: 3 },
    ]);
    expect(derivePacks(buildCards(feats()), [])[0]?.enabled).toBe(false);
  });
});

describe("planChanges · mức ⇒ gói + entitlement", () => {
  test("AC1: Tắt → Sửa ⇒ bật gói ĐÚNG mức Sửa (không cấp Quản trị rồi gỡ), cấp Xem+Sửa, không thu hồi", () => {
    const { plan } = pick([], [pack(false)], "write");
    expect(plan.enablePacks).toEqual(["contracts"]);
    expect(plan.enableLevels).toEqual({ contracts: "write" });
    expect(plan.disablePacks).toEqual([]);
    expect(keys(plan.grant)).toEqual(["contracts-read", "contracts-write"]);
    expect(plan.revoke).toEqual([]); // gói bật chỉ tới Sửa ⇒ lỗi bước sau không để trần lên Quản trị
    expect(plan.revokeShown).toEqual([]);
  });
  test("runPlan truyền mức đích khi bật gói", async () => {
    const { plan } = pick([], [pack(false)], "read");
    const calls: string[] = [];
    await runPlan(plan, {
      setPack: async (k, on, level) => {
        calls.push(`${k}:${on}:${level}`);
      },
      apply: async () => {},
    });
    expect(calls).toEqual(["contracts:true:read"]);
  });
  test("AC2: Sửa → Tắt ⇒ tắt gói, thu hồi mức và tính năng thêm", () => {
    const { plan } = pick(
      ["contracts-read", "contracts-write", "han-muc-duyet"],
      [pack(true)],
      "off",
    );
    expect(plan.disablePacks).toEqual(["contracts"]);
    expect(keys(plan.revoke)).toEqual(["contracts-read", "contracts-write", "han-muc-duyet"]);
    expect(keys(plan.revokeShown)).toEqual(keys(plan.revoke));
    expect(needsConfirm(plan)).toBe(true);
  });
  test("đổi mức khi gói đã bật ⇒ chỉ entitlement, không đụng gói", () => {
    const { plan } = pick(
      ["contracts-read", "contracts-write", "contracts-admin"],
      [pack(true)],
      "read",
    );
    expect(plan.enablePacks).toEqual([]);
    expect(plan.disablePacks).toEqual([]);
    expect(keys(plan.revoke)).toEqual(["contracts-admin", "contracts-write"]);
  });
  test("về đúng mức ban đầu ⇒ bỏ ý định, không đổi gói; app không có gói không sinh việc gói", () => {
    const f = feats(["contracts-read", "contracts-write"]);
    const cards = buildCards(f);
    const card = cards.find((c) => c.app === "contracts") as AppCard;
    const i1 = nextIntent({}, "contracts", "off", "write");
    expect(i1).toEqual({ contracts: false });
    expect(nextIntent(i1, "contracts", "write", "write")).toEqual({});
    const noPack = planChanges(f, cards, [], setLevel(entitledKeys(f), card, "off"), i1);
    expect(noPack.disablePacks).toEqual([]);
    expect(packOf(card, [])).toBeUndefined();
  });
  test("bộ cũ (có quyền nhưng gói chưa bật) và không chạm ⇒ không việc; đổi mức ⇒ bật gói", () => {
    const f = feats(["contracts-write"]);
    const cards = buildCards(f);
    const untouched = planChanges(f, cards, [pack(false)], entitledKeys(f), {});
    expect(untouched.enablePacks).toEqual([]);
    expect(untouched.grant).toEqual([]);
    expect(pick(["contracts-write"], [pack(false)], "admin").plan.enablePacks).toEqual([
      "contracts",
    ]);
  });
  test("chỉ bật/tắt tính năng thêm ⇒ không đổi gói", () => {
    const f = feats(["contracts-read"]);
    const cards = buildCards(f);
    const draft = setKey(entitledKeys(f), "han-muc-duyet", true);
    const plan = planChanges(f, cards, [pack(true)], draft, {});
    expect(plan.enablePacks.length + plan.disablePacks.length).toBe(0);
    expect(keys(plan.grant)).toEqual(["han-muc-duyet"]);
  });
});

describe("hộp xác nhận", () => {
  const tr = (k: string, p?: Record<string, string | number>) =>
    k.startsWith("featmeta.f.") ? `N(${k.split(".")[2]})` : `${k}|${JSON.stringify(p)}`;
  test("tắt gói ⇒ cảnh báo mất quyền kèm số người + liệt kê thu hồi theo tên", () => {
    const { plan } = pick(
      ["contracts-read", "han-muc-duyet"],
      [pack(true, { member_count: 7 })],
      "off",
    );
    const msg = appsConfirmMessage(
      tr,
      "vi",
      plan,
      [pack(true, { member_count: 7 })],
      (k) => `APP:${k}`,
    );
    expect(msg).toContain('tenants.apps.confirmPackOff|{"list":"APP:contracts","members":7}');
    expect(msg).toContain("N(contracts-read), N(han-muc-duyet)");
  });
  test("chỉ bật gói / cấp thêm ⇒ không cần xác nhận", () => {
    expect(needsConfirm(pick([], [pack(false)], "write").plan)).toBe(false);
  });
});

describe("roleStats · vai không hiệu lực theo mức đang chọn", () => {
  const roles = [
    { pack: "contracts", level: "read" as const },
    { pack: "contracts", level: "write" as const },
    { pack: "contracts", level: "admin" as const },
    { pack: "knowledge", level: "admin" as const },
  ];
  test("mức Sửa ⇒ vai Quản trị không hiệu lực, Tắt ⇒ mọi vai, app khác không lẫn", () => {
    expect(roleStats(roles, "contracts", "write")).toEqual({ total: 3, ineffective: 1 });
    expect(roleStats(roles, "contracts", "admin")).toEqual({ total: 3, ineffective: 0 });
    expect(roleStats(roles, "contracts", "off")).toEqual({ total: 3, ineffective: 3 });
    expect(roleStats(roles, "knowledge", "read")).toEqual({ total: 1, ineffective: 1 });
  });
});

describe("runPlan · thứ tự và lỗi từng phần", () => {
  const f = (k: string): TenantFeature => ({
    id: k,
    key: k,
    name: { vi: k },
    app: appOfKey(k),
    entitled: true,
  });
  const plan: AppsPlan = {
    enablePacks: ["a"],
    grant: [f("g1")],
    revoke: [f("r1")],
    revokeShown: [f("r1")],
    disablePacks: ["b"],
  };
  const recorder = (failOn?: string) => {
    const log: string[] = [];
    const io: PlanIO = {
      setPack: async (k, on) => {
        log.push(`${on ? "enable" : "disable"}:${k}`);
        if (failOn === (on ? "enable" : "disable")) throw new Error("boom");
      },
      apply: async (g, r) => {
        log.push(`apply:${g}|${r}`);
        if (failOn === "apply") throw new Error("boom");
      },
    };
    return { log, io };
  };
  test("bật gói TRƯỚC khi cấp, thu hồi TRƯỚC khi tắt gói", async () => {
    const { log, io } = recorder();
    const done = await runPlan(plan, io);
    expect(log).toEqual(["enable:a", "apply:g1|r1", "disable:b"]);
    expect(done).toEqual(["pack+:a", "entitlements", "pack-:b"]);
  });
  test("bật gói lỗi ⇒ dừng, không cấp/tắt gì thêm", async () => {
    const { log, io } = recorder("enable");
    const err = await runPlan(plan, io).catch((e) => e);
    expect(err).toBeInstanceOf(PlanError);
    expect(log).toEqual(["enable:a"]);
    expect((err as PlanError).done).toEqual([]);
  });
  test("entitlement lỗi ⇒ gói đã bật được ghi nhận, KHÔNG tắt gói (người dùng chưa mất quyền)", async () => {
    const { log, io } = recorder("apply");
    const err = (await runPlan(plan, io).catch((e) => e)) as PlanError;
    expect(log).toEqual(["enable:a", "apply:g1|r1"]);
    expect(err.done).toEqual(["pack+:a"]);
    expect((err.reason as Error).message).toBe("boom");
  });
  test("tắt gói lỗi ⇒ phần trước đã xong, báo đủ", async () => {
    const { io } = recorder("disable");
    const err = (await runPlan(plan, io).catch((e) => e)) as PlanError;
    expect(err.done).toEqual(["pack+:a", "entitlements"]);
  });
  test("kế hoạch rỗng ⇒ không gọi gì", async () => {
    const { log, io } = recorder();
    await runPlan(
      { enablePacks: [], grant: [], revoke: [], revokeShown: [], disablePacks: [] },
      io,
    );
    expect(log).toEqual([]);
  });
});
