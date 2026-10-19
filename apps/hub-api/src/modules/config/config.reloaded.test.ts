// PK-FR-05 · N1 T5b (readiness #6) · `ConfigCache.reloaded(minAdminVersion?)`: tín hiệu nạp Admin xong (nguồn giả, không DB).
import { describe, expect, test } from "bun:test";
import type { Logger } from "../../lib/logger";
import type { CatalogRows } from "./catalog.rules";
import type { ConfigSnapshot } from "./config.rules";
import { ConfigCache, type ConfigSource } from "./config.service";

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

function source(state: { admin: number }): ConfigSource {
  return {
    readVersions: async () => ({ admin: state.admin, hub: 1 }),
    loadHub: async () => ({ version: 1 }) as unknown as ConfigSnapshot,
    loadTenants: async () => [],
    loadUsers: async () => [],
    loadCatalog: async (adminVersion) => ({ ...EMPTY, adminVersion }),
    listen: async () => async () => {},
  };
}

describe("ConfigCache.reloaded", () => {
  test("PK-FR-05 · đã đạt version ⇒ resolve ngay; chưa đạt ⇒ chờ lần nạp có version ≥ min", async () => {
    const st = { admin: 3 };
    const c = new ConfigCache(source(st), { pollS: 3600, log: silent });
    await c.reloadAdmin();
    expect(await c.reloaded(3)).toBe(3);
    const later = c.reloaded(5);
    let got = 0;
    void later.then((v) => {
      got = v;
    });
    st.admin = 4;
    await c.reloadAdmin();
    expect(got).toBe(0); // 4 < 5: vẫn chờ
    st.admin = 5;
    await c.reloadAdmin();
    expect(await later).toBe(5);
    await c.stop();
  });
});

describe("ConfigCache.adminSettled", () => {
  test("PK-FR-05 · adminSettled(): không nạp ⇒ resolve ngay; đang nạp ⇒ chờ nạp xong, không kích hoạt nạp thêm", async () => {
    const st = { admin: 1 };
    let release: () => void = () => {};
    const opened = new Promise<void>((r) => {
      release = r;
    });
    let loads = 0;
    const src = source(st);
    const gate = { on: false };
    src.loadTenants = async () => {
      loads++;
      if (gate.on) await opened;
      return [];
    };
    const c = new ConfigCache(src, { pollS: 3600, log: silent });
    await c.reloadAdmin();
    await c.adminSettled();
    expect(loads).toBe(1);
    gate.on = true;
    st.admin = 2;
    const run = c.reloadAdmin();
    let settled = false;
    const s = c.adminSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await Promise.all([run, s]);
    expect({ settled, loads, v: await c.reloaded(2) }).toEqual({ settled: true, loads: 2, v: 2 });
    await c.stop();
  });
});

describe("ConfigCache.reloaded · không tham số / dừng", () => {
  test("PK-FR-05 · không tham số ⇒ chờ lần nạp KẾ; stop() trả version hiện có (không treo)", async () => {
    const st = { admin: 7 };
    const c = new ConfigCache(source(st), { pollS: 3600, log: silent });
    await c.reloadAdmin();
    const next = c.reloaded();
    st.admin = 8;
    await c.reloadAdmin();
    expect(await next).toBe(8);
    const hanging = c.reloaded(99);
    await c.stop();
    expect(await hanging).toBe(8);
    expect(await c.reloaded(100)).toBe(8);
  });
});
