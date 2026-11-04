// CR-118 · cr118-r1-fixes #1 · tenant bị chạm từ NOTIFY không bị rơi giữa hai lần nạp Admin gộp (coalesce). Tái hiện đan xen
// bằng nguồn giả có cổng chặn `readVersions` (promise), không sleep.
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
const X = "00000000-0000-4000-8000-00000000000a";
const Y = "00000000-0000-4000-8000-00000000000b";

describe("CR-118 · ConfigCache · tenant chạm giữa hai lần nạp gộp", () => {
  test("NOTIFY Y xen giữa hai lần nạp gộp ⇒ Y vẫn được phát", async () => {
    const st = { admin: 1, hub: 1 };
    const subs = new Map<string, (p: string) => void>();
    let gate: (() => void) | null = null;
    let entered: (() => void) | null = null;
    const src: ConfigSource = {
      readVersions: async () => {
        if (gate === null && entered) {
          const e = entered;
          entered = null;
          await new Promise<void>((r) => {
            gate = r;
            e();
          });
        }
        return { admin: st.admin, hub: st.hub };
      },
      loadHub: async () => ({ version: st.hub }) as unknown as ConfigSnapshot,
      loadTenants: async () => [],
      loadUsers: async () => [],
      loadCatalog: async (adminVersion) => ({ ...EMPTY, adminVersion }),
      listen: async (ch, fn) => {
        subs.set(ch, fn);
        return async () => {};
      },
    };
    const c = new ConfigCache(src, { pollS: 3600, log: silent });
    const got: ConfigChange[] = [];
    c.onChange((x) => got.push(x));
    c.start();
    await c.ready();
    const notify = (tid: string, v: number) =>
      subs.get("config_changed")?.(JSON.stringify({ v, entity: "tenant", tenant_id: tid }));

    // lần nạp 1 chụp {X} rồi dừng TRƯỚC readVersions
    const atRead = new Promise<void>((r) => {
      entered = r;
    });
    st.admin = 2;
    notify(X, 2);
    await atRead;
    // Y commit (version 3) + NOTIFY tới khi lần nạp 1 chưa đọc version ⇒ lần nạp 1 thấy 3
    st.admin = 3;
    notify(Y, 3);
    (gate as unknown as () => void)();
    await c.adminSettled();

    const touched = new Set<string>();
    for (const g of got) for (const t of g.tenants ?? [X, Y]) touched.add(t);
    expect([...touched].sort()).toEqual([X, Y]);
    expect(c.versions().admin).toBe(3);
    await c.stop();
  });
});
