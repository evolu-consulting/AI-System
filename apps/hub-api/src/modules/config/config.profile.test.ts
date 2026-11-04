// CR-118 · cr118-r1-fixes #3 · NOTIFY `profile_changed` (default_app/brand của MỘT tenant) ⇒ ConfigCache chỉ nạp lát
// tenant/user (không catalog), version Admin giữ nguyên, phát đúng tenant; mất NOTIFY ⇒ poll thấy `profile_version` đổi.
import { describe, expect, test } from "bun:test";
import type { Logger } from "../../lib/logger";
import type { CatalogRows } from "./catalog.rules";
import type { ConfigSnapshot, UserState } from "./config.rules";
import { ConfigCache, type ConfigChange, type ConfigSource } from "./config.service";

const silent: Logger = (() => {
  const noop = () => {};
  const l = { debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => l };
  return l;
})();
const EMPTY: Omit<CatalogRows, "adminVersion"> = {
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
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const UA = "00000000-0000-4000-8000-0000000000a1";
const UB = "00000000-0000-4000-8000-0000000000b1";

function setup() {
  const st = { admin: 1, hub: 1, profile: 1, app: "x" as string | null };
  const calls = { catalog: 0, users: [] as string[][] };
  const subs = new Map<string, (p: string) => void>();
  const user = (id: string, tenantId: string): UserState => ({
    id,
    tenantId,
    active: true,
    lockedByTenant: false,
    locale: "vi",
    groupIds: new Set(),
    defaultApp: tenantId === A ? st.app : null,
  });
  const src: ConfigSource = {
    readVersions: async () => ({ admin: st.admin, hub: st.hub, profile: st.profile }),
    loadHub: async () => ({ version: st.hub }) as unknown as ConfigSnapshot,
    loadTenants: async () => [
      { id: A, active: true, maxConcurrentSub: null, defaultApp: st.app },
      { id: B, active: true, maxConcurrentSub: null, defaultApp: null },
    ],
    loadUsers: async (ids) => {
      calls.users.push([...ids]);
      return ids.map((id) => user(id, id === UA ? A : B));
    },
    loadCatalog: async (adminVersion) => {
      calls.catalog++;
      return { ...EMPTY, adminVersion };
    },
    listen: async (ch, fn) => {
      subs.set(ch, fn);
      return async () => {};
    },
  };
  const c = new ConfigCache(src, { pollS: 3600, log: silent });
  const got: ConfigChange[] = [];
  c.onChange((x) => got.push(x));
  return { st, calls, subs, c, got };
}

describe("CR-118 · cr118-r1-fixes · ConfigCache lát profile", () => {
  test("profile_changed ⇒ chỉ nạp lát tenant/user, phát {A}", async () => {
    const { st, calls, subs, c, got } = setup();
    c.start();
    await c.ready();
    await c.user(UA);
    await c.user(UB);
    const catalog0 = calls.catalog;
    calls.users.length = 0;
    st.profile = 2;
    st.app = "contracts";
    subs.get("profile_changed")?.(JSON.stringify({ v: 2, entity: "user", tenant_id: A }));
    await c.adminSettled();
    expect({
      catalog: calls.catalog - catalog0,
      users: calls.users,
      versions: c.versions(),
      tenants: got.map((g) => (g.tenants ? [...g.tenants] : null)),
      userApp: (await c.user(UA))?.defaultApp,
      tenantApp: (await c.tenant(A))?.defaultApp,
    }).toEqual({
      catalog: 0,
      users: [[UA]],
      versions: { admin: 1, hub: 1 },
      tenants: [[A]],
      userApp: "contracts",
      tenantApp: "contracts",
    });
    await c.stop();
  });

  test("poll thấy profile_version đổi ⇒ nạp lát profile", async () => {
    const { st, calls, c, got } = setup();
    c.start();
    await c.ready();
    const catalog0 = calls.catalog;
    st.profile = 5; // mất NOTIFY
    st.app = "community";
    await c.poll();
    expect({
      catalog: calls.catalog - catalog0,
      changes: got.map((g) => g.tenants),
      tenantApp: (await c.tenant(A))?.defaultApp,
    }).toEqual({ catalog: 0, changes: [null], tenantApp: "community" });
    await c.poll(); // không đổi ⇒ không nạp, không phát
    expect(got.length).toBe(1);
    await c.stop();
  });
});
