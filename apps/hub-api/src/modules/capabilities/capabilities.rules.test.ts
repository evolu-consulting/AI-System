// CR-118 · UW-FR-04 · UW-FR-16..19 · luật thuần ảnh năng lực (`/pack/me` + capabilities theo tenant).
import { describe, expect, it } from "bun:test";
import {
  addonKeysOf,
  type CapsInput,
  etagMatches,
  etagOf,
  installedPacks,
  levelOf,
  type ShellInput,
  shellMe,
  tenantCapabilities,
} from "./capabilities.rules";

const T = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";
const F = (key: string, status = "on") => ({ id: `f-${key}`, key, status });
const FEATURES = [
  F("contracts-read"),
  F("contracts-write"),
  F("contracts-admin"),
  F("contracts-approval-engine"),
  F("contracts.extract"),
  F("contracts.price_scout", "off"),
  F("community-read"),
  F("community-write"),
  F("community-admin"),
  F("dlc-read"),
  F("dlc-write"),
  F("dlc-admin"),
  F("chat-app"),
];

const shell = (o: Partial<ShellInput> = {}): ShellInput => ({
  versions: { admin: 3, hub: 7 },
  user: { id: U, tenantId: T, role: "member", external: false },
  packs: [
    { key: "contracts", enabled: true, actions: ["read", "write"] },
    { key: "community", enabled: true, actions: ["read"] },
  ],
  addons: [
    { pack: "contracts", key: "contracts-approval-engine", on: true },
    { pack: "contracts", key: "contracts.extract", on: false },
  ],
  brand: { name: "ACME", app_name: null, logo: null, accent: "#123456" },
  ...o,
});

describe("CR-118 · installedPacks / addonKeysOf", () => {
  it("gói = bộ đủ read/write/admin; bỏ DLC (của Rowan) và feature lẻ", () => {
    expect(installedPacks(FEATURES)).toEqual(["community", "contracts"]);
  });
  it("add-on = feature cùng tiền tố gói, trừ 3 mức", () => {
    expect(addonKeysOf(FEATURES, "contracts")).toEqual([
      "contracts-approval-engine",
      "contracts.extract",
      "contracts.price_scout",
    ]);
    expect(addonKeysOf(FEATURES, "community")).toEqual([]);
  });
  it("levelOf: mức cao nhất trong actions", () => {
    expect(levelOf([])).toBe("off");
    expect(levelOf(["read"])).toBe("read");
    expect(levelOf(["read", "write", "admin"])).toBe("admin");
  });
});

describe("CR-118 · UW-FR-04 · shellMe", () => {
  it('cờ flow.runtime: mặc định tắt (false), bật theo đầu vào ⇒ web biết có gọi route "/flow/*" hay không', () => {
    expect(shellMe(shell()).flags["flow.runtime"]).toBe(false);
    expect(shellMe(shell({ flowRuntime: true })).flags["flow.runtime"]).toBe(true);
  });

  it("packs + mức + flags phẳng + home = contracts khi đọc được", () => {
    const r = shellMe(shell());
    expect(r.packs.contracts).toEqual({
      enabled: true,
      level: "write",
      actions: ["read", "write"],
    });
    expect(r.apps).toEqual(["contracts", "community"]);
    expect(r.home).toBe("contracts");
    expect(r.addons).toEqual(["contracts-approval-engine"]);
    expect(r.flags).toMatchObject({
      contracts: true,
      "contracts.read": true,
      "contracts.write": true,
      "contracts.admin": false,
      "contracts-approval-engine": true,
      "contracts.extract": false,
      community: true,
    });
    expect(r.versions).toEqual({ admin: 3, hub: 7 });
  });
  it("đối tác: chỉ gói mở cho đối tác, contracts luôn tắt + add-on contracts tắt, home = community", () => {
    const r = shellMe(shell({ user: { id: U, tenantId: T, role: "member", external: true } }));
    expect(r.packs.contracts).toEqual({ enabled: false, level: "off", actions: [] });
    expect(r.addons).toEqual([]);
    expect(r.flags.contracts).toBe(false);
    expect(r.flags["contracts-approval-engine"]).toBe(false);
    expect(r.home).toBe("community");
    expect(r.user.kind).toBe("external");
  });
  it("gói bật nhưng không có quyền đọc ⇒ không vào apps, add-on tắt", () => {
    const r = shellMe(
      shell({ packs: [{ key: "contracts", enabled: true, actions: [] }], addons: shell().addons }),
    );
    expect(r.apps).toEqual([]);
    expect(r.home).toBeNull();
    expect(r.addons).toEqual([]);
  });
  it("home theo default_app (user trước công ty) khi user đọc được gói đó, app không phải gói/không đọc được ⇒ theo quyền", () => {
    const home = (o: Partial<ShellInput>) => shellMe(shell(o)).home;
    expect(home({ defaultApp: { user: null, tenant: "community" } })).toBe("community");
    expect(home({ defaultApp: { user: "contracts", tenant: "community" } })).toBe("contracts");
    expect(home({ defaultApp: { user: "chat", tenant: "community" } })).toBe("community");
    expect(home({ defaultApp: { user: "chat", tenant: "admin" } })).toBe("contracts");
    const ext = { user: { id: U, tenantId: T, role: "member", external: true } };
    expect(home({ ...ext, defaultApp: { user: null, tenant: "contracts" } })).toBe("community");
  });
});

describe("CR-118 · ETag", () => {
  it("ETag gồm cặp version + băm nội dung; nội dung đổi ⇒ ETag đổi", () => {
    const a = etagOf({ admin: 3, hub: 7 }, '{"x":1}');
    expect(a).toMatch(/^"a3\.h7\.[0-9a-z]+"$/);
    expect(etagOf({ admin: 3, hub: 7 }, '{"x":2}')).not.toBe(a);
    expect(etagOf({ admin: 4, hub: 7 }, '{"x":1}')).not.toBe(a);
  });
  it("If-None-Match: khớp chính xác, W/ và danh sách; rỗng/khác ⇒ không", () => {
    const e = etagOf({ admin: 1, hub: 1 }, "b");
    expect(etagMatches(e, e)).toBe(true);
    expect(etagMatches(`W/${e}`, e)).toBe(true);
    expect(etagMatches(`"x", ${e}`, e)).toBe(true);
    expect(etagMatches("*", e)).toBe(true);
    expect(etagMatches(undefined, e)).toBe(false);
    expect(etagMatches('"a1.h1.zz"', e)).toBe(false);
  });
});

const caps = (o: Partial<CapsInput> = {}): CapsInput => ({
  tenantId: T,
  versions: { admin: 3, hub: 7 },
  features: FEATURES,
  entitled: (fid) =>
    ["f-contracts-read", "f-contracts-write", "f-contracts-approval-engine"].includes(fid),
  agents: [
    { id: "a1", key: "assistant", name: "Trợ lý", enabled: true },
    { id: "a2", key: "price-scout", name: "Dò giá", enabled: true },
    { id: "a3", key: "writer", name: "Viết", enabled: false },
    { id: "a4", key: "other", name: "Khác", enabled: true },
  ],
  entitledAgentIds: new Set(["a1", "a3"]),
  packAgents: new Map([["contracts", ["assistant", "price-scout"]]]),
  tools: (p) =>
    p === "contracts"
      ? [{ key: "contracts-get", side_effect: false, action: "read" as const }]
      : [],
  slots: [
    { tenantId: null, slot: "contracts.approval", defId: "d1", defName: "Duyệt v4", version: 4 },
    { tenantId: T, slot: "contracts.approval", defId: "d2", defName: "Duyệt riêng", version: 2 },
    { tenantId: "other", slot: "contracts.approval", defId: "d9", defName: "X", version: 1 },
    { tenantId: null, slot: "dlc.step", defId: "d5", defName: "DLC", version: 1 },
  ],
  standalone: [{ id: "d7", name: "Tự do", version: 1, tenantId: null }],
  workflows: [{ id: "w1", key: "summarize", name: "Tóm tắt", enabled: true }],
  agentWorkflows: new Map([["a3", new Set(["w1"])]]),
  defaults: { defaultAgentId: "a3", fallbackAgentId: null, onNoMatch: "fallback" },
  limits: { uploads: 10, actions: null, aiTokens: 5000 },
  ...o,
});

describe("CR-118 · UW-FR-16..19 · tenantCapabilities", () => {
  it("thẻ app: mức tenant, add-on, khe (gán riêng thắng mặc định, bỏ khe DLC + tenant khác), agent + tool của app", () => {
    const r = tenantCapabilities(caps());
    const app = r.apps.find((a) => a.key === "contracts");
    expect(app?.level).toBe("write");
    expect(app?.addons).toEqual([
      { key: "contracts-approval-engine", on: true },
      { key: "contracts.extract", on: false },
      { key: "contracts.price_scout", on: false },
    ]);
    expect(app?.slots).toEqual([
      {
        slot: "contracts.approval",
        def_id: "d2",
        def_name: "Duyệt riêng",
        version: 2,
        is_default: false,
      },
    ]);
    expect(app?.agents).toEqual([
      { key: "assistant", name: "Trợ lý", enabled: true },
      { key: "price-scout", name: "Dò giá", enabled: false },
    ]);
    expect(app?.tools).toEqual([{ key: "contracts-get", side_effect: false, action: "read" }]);
    expect(r.apps.map((a) => a.key)).toEqual(["community", "contracts"]);
    expect(r.apps.find((a) => a.key === "community")?.level).toBe("off");
  });
  it("Dùng chung: agent không thuộc gói (đã cấp cho tenant), Dify chỉ đọc + agent dùng, flow độc lập, model mặc định", () => {
    const r = tenantCapabilities(caps());
    expect(r.shared.agents).toEqual([{ key: "writer", name: "Viết", enabled: false }]);
    expect(r.shared.dify_workflows).toEqual([
      { key: "summarize", name: "Tóm tắt", enabled: true, used_by: ["writer"] },
    ]);
    expect(r.shared.standalone_flows).toEqual([{ id: "d7", name: "Tự do", version: 1 }]);
    expect(r.shared.default_model).toEqual({
      default_agent: "writer",
      fallback_agent: null,
      on_no_match: "fallback",
    });
    expect(r.limits).toEqual({ uploads_day: 10, actions_day: null, ai_tokens_day: 5000 });
  });
  it("khe chưa gán ⇒ mặc định (is_default)", () => {
    const r = tenantCapabilities(caps({ slots: caps().slots.filter((s) => s.tenantId !== T) }));
    expect(r.apps.find((a) => a.key === "contracts")?.slots[0]).toMatchObject({
      def_id: "d1",
      is_default: true,
    });
  });
});
