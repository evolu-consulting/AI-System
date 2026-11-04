// CR-118 N3 · `ConfigCache.onChange`: phát SAU khi nạp xong và version đổi; tenant theo `tenant_id` của NOTIFY; lần nạp đầu
// không phát (nguồn giả, không DB).
import { describe, expect, test } from "bun:test";
import type { Logger } from "../../lib/logger";
import type { CatalogRows } from "./catalog.rules";
import type { ConfigSnapshot } from "./config.rules";
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

function source(st: { admin: number; hub: number }, subs: Map<string, (p: string) => void>) {
  const s: ConfigSource = {
    readVersions: async () => ({ admin: st.admin, hub: st.hub }),
    loadHub: async () => ({ version: st.hub }) as unknown as ConfigSnapshot,
    loadTenants: async () => [],
    loadUsers: async () => [],
    loadCatalog: async (adminVersion) => ({ ...EMPTY, adminVersion }),
    listen: async (ch, fn) => {
      subs.set(ch, fn);
      return async () => {};
    },
  };
  return s;
}

describe("CR-118 N3 · ConfigCache.onChange", () => {
  test("nạp đầu không phát; admin đổi qua NOTIFY có tenant_id ⇒ tenants={A}; hub đổi ⇒ null; version y nguyên ⇒ không phát", async () => {
    const st = { admin: 1, hub: 1 };
    const subs = new Map<string, (p: string) => void>();
    const c = new ConfigCache(source(st, subs), { pollS: 3600, log: silent });
    const got: ConfigChange[] = [];
    c.onChange((x) => got.push(x));
    c.start();
    await c.ready();
    expect(got).toEqual([]);
    expect(c.versions()).toEqual({ admin: 1, hub: 1 });
    st.admin = 2;
    subs.get("config_changed")?.(JSON.stringify({ v: 2, entity: "group", tenant_id: A }));
    await c.reloaded(2);
    expect(got).toEqual([{ admin: 2, hub: 1, tenants: new Set([A]) }]);
    st.hub = 5;
    await c.reloadHub();
    expect(got[1]).toEqual({ admin: 2, hub: 5, tenants: null });
    await c.reloadAdmin(); // version không đổi
    expect(got.length).toBe(2);
    await c.stop();
  });
});
