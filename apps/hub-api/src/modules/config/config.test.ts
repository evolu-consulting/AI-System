// HUB-FR-02, HUB-FR-03, HUB-BR-06, HUB-BR-08 · unit test cache cấu hình (nguồn giả, không DB) + luật thuần.
import { describe, expect, test } from "bun:test";
import { CONFIG_CHANNEL } from "@ai/contracts";
import { HUB_CONFIG_CHANNEL } from "@ai/contracts/hub";
import type { Logger } from "../../lib/logger";
import type { CatalogRows } from "./catalog.rules";
import { splitOrchestratorRows } from "./config.repo";
import {
  type AgentConfig,
  accountUsable,
  type ConfigSnapshot,
  type OrchestratorConfig,
  orchestratorProblem,
  pickOrchestrator,
  type TenantState,
  type UserState,
} from "./config.rules";
import { ConfigCache, type ConfigSource } from "./config.service";

const T1 = "00000000-0000-4000-8000-000000000001";
const U1 = "00000000-0000-4000-8000-000000000011";
const ORCH = "00000000-0000-4000-8000-000000000021";

const agent = (o: Partial<AgentConfig> = {}): AgentConfig => ({
  id: ORCH,
  key: "orchestrator",
  name: { vi: "o", en: "o" },
  description: "Điều phối yêu cầu tới agent phù hợp.",
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: ORCH,
  systemPrompt: "",
  runtimeOptions: {},
  timeoutS: 600,
  tokenBudget: null,
  enabled: true,
  version: 1,
  ...o,
});
const ORCH_CFG: OrchestratorConfig = {
  agentId: ORCH,
  maxSteps: 5,
  tokenBudget: 200000,
  historyN: 10,
  onNoMatch: "answer",
  version: 1,
};
const snap = (version: number, o: Partial<ConfigSnapshot> = {}): ConfigSnapshot => ({
  version,
  providers: [],
  profiles: [],
  agents: [agent()],
  orchestrator: ORCH_CFG,
  entitlements: [],
  grants: [],
  agentWorkflows: new Map(),
  orchestratorTenants: new Map(),
  ...o,
});

const silent: Logger = (() => {
  const noop = () => {};
  const l = { debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => l };
  return l;
})();

type Fake = ConfigSource & {
  db: { admin: number; hub: ConfigSnapshot; tenants: TenantState[]; users: UserState[] };
  emit(channel: string, payload: string): void;
  listeners: Map<string, (p: string) => void>;
  calls: { hub: number; admin: number };
};
function fakeSource(): Fake {
  const listeners = new Map<string, (p: string) => void>();
  const calls = { hub: 0, admin: 0 };
  const db = {
    admin: 1,
    hub: snap(1),
    tenants: [{ id: T1, active: true, maxConcurrentSub: null }],
    users: [
      {
        id: U1,
        tenantId: T1,
        active: true,
        lockedByTenant: false,
        locale: "vi",
        groupIds: new Set(),
      },
    ] as UserState[],
  };
  return {
    db,
    listeners,
    calls,
    emit: (c, p) => listeners.get(c)?.(p),
    readVersions: async () => ({ admin: db.admin, hub: db.hub.version }),
    loadHub: async () => {
      calls.hub++;
      return db.hub;
    },
    loadTenants: async () => {
      calls.admin++;
      return db.tenants.map((t) => ({ ...t }));
    },
    loadUsers: async (ids) => db.users.filter((u) => ids.includes(u.id)).map((u) => ({ ...u })),
    loadCatalog: async (adminVersion) => ({ ...EMPTY_CATALOG, adminVersion }),
    listen: async (c, fn) => {
      listeners.set(c, fn);
      return async () => {
        listeners.delete(c);
      };
    },
  };
}
const EMPTY_CATALOG: CatalogRows = {
  adminVersion: 0,
  workflows: [],
  commands: [],
  names: [],
  features: [],
  featureCommands: [],
  entitlements: [],
  grants: [],
  groups: [],
  tenants: [],
};
const tick = () => new Promise((r) => setTimeout(r, 5));

function startCache(src: Fake, signal?: AbortSignal): ConfigCache {
  const c = new ConfigCache(src, { pollS: 3600, log: silent, signal });
  c.start();
  return c;
}

describe("config.rules", () => {
  test("HUB-BR-08 · orchestratorProblem: hợp lệ / thiếu settings / thiếu agent / tắt / sai runtime", () => {
    expect(orchestratorProblem(snap(1))).toBeNull();
    expect(orchestratorProblem(snap(1, { orchestrator: null }))).toBe("missing_settings");
    expect(orchestratorProblem(snap(1, { agents: [] }))).toBe("missing_agent");
    expect(orchestratorProblem(snap(1, { agents: [agent({ enabled: false })] }))).toBe("disabled");
    expect(orchestratorProblem(snap(1, { agents: [agent({ runtime: "llm" })] }))).toBe(
      "not_agentic_cli",
    );
  });

  test("H1-R04 · accountUsable: tenant khoá / user tắt / locked_by_tenant / khác tenant → false", () => {
    const t: TenantState = { id: T1, active: true, maxConcurrentSub: null };
    const u: UserState = {
      id: U1,
      tenantId: T1,
      active: true,
      lockedByTenant: false,
      locale: "vi",
      groupIds: new Set(),
    };
    expect(accountUsable(t, u)).toBe(true);
    expect(accountUsable(undefined, u)).toBe(false);
    expect(accountUsable(t, undefined)).toBe(false);
    expect(accountUsable({ ...t, active: false }, u)).toBe(false);
    expect(accountUsable(t, { ...u, active: false })).toBe(false);
    expect(accountUsable(t, { ...u, lockedByTenant: true })).toBe(false);
    expect(accountUsable(t, { ...u, tenantId: ORCH })).toBe(false);
  });
});

describe("ConfigCache · NOTIFY", () => {
  test("HUB-FR-02 · nạp đầu + LISTEN 2 kênh; config_changed → nạp lại admin (tenant khoá thấy ngay)", async () => {
    const src = fakeSource();
    const c = startCache(src);
    expect(await c.accountUsable(T1, U1)).toBe(true);
    expect([...src.listeners.keys()].sort()).toEqual([CONFIG_CHANNEL, HUB_CONFIG_CHANNEL].sort());
    src.db.tenants = [{ id: T1, active: false, maxConcurrentSub: null }];
    src.db.admin = 2;
    src.emit(CONFIG_CHANNEL, JSON.stringify({ v: 2, entity: "tenant", tenant_id: T1 }));
    await tick();
    expect(await c.accountUsable(T1, U1)).toBe(false);
    await c.stop();
  });

  test("HUB-FR-02 · user đã cache được làm mới khi config_changed (không tenant_id ⇒ nạp lại toàn bộ)", async () => {
    const src = fakeSource();
    const c = startCache(src);
    expect((await c.user(U1))?.lockedByTenant).toBe(false);
    src.db.users = src.db.users.map((u) => ({ ...u, lockedByTenant: true }));
    src.emit(CONFIG_CHANNEL, "khong-phai-json");
    await tick();
    expect((await c.user(U1))?.lockedByTenant).toBe(true);
    await c.stop();
  });

  test("HUB-BR-06 · hub_config_changed version mới → ảnh mới; ảnh cũ của run giữ nguyên; version cũ bị bỏ qua", async () => {
    const src = fakeSource();
    const c = startCache(src);
    const old = await c.snapshot();
    src.db.hub = snap(2, { agents: [agent(), agent({ id: U1, key: "helper" })] });
    src.emit(HUB_CONFIG_CHANNEL, JSON.stringify({ v: 1, version: 2 }));
    await tick();
    const now = await c.snapshot();
    expect(now.version).toBe(2);
    expect(old.version).toBe(1);
    expect(old.agents).toHaveLength(1);
    const before = src.calls.hub;
    src.emit(HUB_CONFIG_CHANNEL, JSON.stringify({ v: 1, version: 2 }));
    await tick();
    expect(src.calls.hub).toBe(before);
    await c.stop();
  });
});

describe("ConfigCache · poll", () => {
  test("HUB-FR-03 · poll: đổi phiên bản không NOTIFY → nạp lại đúng phần đổi", async () => {
    const src = fakeSource();
    const c = startCache(src);
    await c.ready();
    const base = { ...src.calls };
    await c.poll();
    expect(src.calls).toEqual(base);
    src.db.hub = snap(3);
    await c.poll();
    expect((await c.snapshot()).version).toBe(3);
    expect(src.calls.admin).toBe(base.admin);
    src.db.admin = 5;
    await c.poll();
    expect(src.calls.admin).toBe(base.admin + 1);
    await c.stop();
  });

  test("HUB-FR-03 · abort signal → bỏ LISTEN, poll không nạp nữa", async () => {
    const src = fakeSource();
    const ac = new AbortController();
    const c = startCache(src, ac.signal);
    await c.ready();
    await tick();
    expect(src.listeners.size).toBe(2);
    ac.abort();
    await tick();
    expect(src.listeners.size).toBe(0);
    src.db.hub = snap(9);
    await c.poll();
    expect((await c.snapshot()).version).toBe(1);
  });
});

describe("ConfigCache · nạp lỗi", () => {
  test("HUB-FR-02 · nạp đầu lỗi → lần gọi sau thử lại", async () => {
    const src = fakeSource();
    let fail = true;
    const loadHub = src.loadHub;
    src.loadHub = async () => {
      if (fail) throw new Error("db down");
      return loadHub();
    };
    const c = startCache(src);
    await expect(c.snapshot()).rejects.toThrow("db down");
    fail = false;
    expect((await c.snapshot()).version).toBe(1);
    await c.stop();
  });
});

describe("ConfigCache · đua user() với nạp Admin", () => {
  test("HUB-FR-03 · user() đọc cũ xen lần nạp Admin → không cache bản cũ; lần sau đọc bản mới", async () => {
    const src = fakeSource();
    const U2 = "00000000-0000-4000-8000-000000000022";
    const old: UserState = { ...(src.db.users[0] as UserState), id: U2, locale: "vi" };
    src.db.users.push(old);
    const c = startCache(src);
    await c.ready();
    const load = src.loadUsers;
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    src.loadUsers = async (ids) => {
      const rows = await load(ids);
      if (ids.length === 1 && ids[0] === U2) await gate;
      return rows;
    };
    const slow = c.user(U2);
    await tick();
    src.db.users = src.db.users.map((u) => (u.id === U2 ? { ...u, locale: "en" } : u));
    src.db.admin = 2;
    await c.reloadAdmin();
    release();
    expect((await slow)?.locale).toBe("vi");
    src.loadUsers = load;
    expect((await c.user(U2))?.locale).toBe("en");
    await c.stop();
  });
});

describe("config H2b · Orchestrator theo tenant", () => {
  test("HUB-FR-62 · H2b-R14 · pickOrchestrator: bản tenant hợp lệ dùng cả khi mặc định thiếu; null khi cả hai thiếu", () => {
    const own = { ...ORCH_CFG, agentId: U1, maxSteps: 2 };
    const s = snap(1, {
      orchestrator: null,
      agents: [agent(), agent({ id: U1, key: "orch-t1" })],
      orchestratorTenants: new Map([[T1, own]]),
    });
    expect(pickOrchestrator(s, T1)).toEqual({ config: own, tenantId: T1, invalid: false });
    expect(pickOrchestrator(s, ORCH)).toBeNull();
    const off = { ...s, agents: [agent({ id: U1, enabled: false })] };
    expect(pickOrchestrator(off, T1)).toBeNull();
    const withDefault = { ...off, orchestrator: ORCH_CFG };
    expect(pickOrchestrator(withDefault, T1)).toEqual({
      config: ORCH_CFG,
      tenantId: null,
      invalid: true,
    });
  });

  test("H2b P6 · splitOrchestratorRows: tenant_id NULL → mặc định, còn lại → orchestratorTenants", () => {
    const row = (id: number, tenantId: string | null, agentId: string) => ({
      id,
      tenantId,
      agentId,
      maxSteps: 5,
      tokenBudget: 200000,
      historyN: 10,
      onNoMatch: "answer" as const,
      version: id,
      updatedBy: null,
      updatedAt: new Date(0),
    });
    const r = splitOrchestratorRows([row(1, null, ORCH), row(2, T1, U1)]);
    expect(r.orchestrator?.agentId).toBe(ORCH);
    expect([...r.orchestratorTenants.keys()]).toEqual([T1]);
    expect(r.orchestratorTenants.get(T1)).toMatchObject({ agentId: U1, version: 2 });
    const onlyTenant = splitOrchestratorRows([row(2, T1, U1)]);
    expect(onlyTenant.orchestrator).toBeNull();
    expect(splitOrchestratorRows([]).orchestratorTenants.size).toBe(0);
  });
});

describe("config H2b · REVIEW 1 Hub #3", () => {
  test("REVIEW 1 Hub #3 · pickOrchestrator: agent bản tenant runtime ≠ agentic-cli → mặc định + invalid (như orchestratorProblem)", () => {
    const own = { ...ORCH_CFG, agentId: U1 };
    const s = snap(1, {
      orchestrator: ORCH_CFG,
      agents: [agent(), agent({ id: U1, key: "orch-t1", runtime: "dify-agent" })],
      orchestratorTenants: new Map([[T1, own]]),
    });
    expect(pickOrchestrator(s, T1)).toEqual({ config: ORCH_CFG, tenantId: null, invalid: true });
    expect(pickOrchestrator({ ...s, orchestrator: null }, T1)).toBeNull();
  });
});
