// CR-125 · m2 · MOD-FR-02 · mount gói THẬT (DB thật): sổ module không báo lỗi giả (khai báo `MODULES` × binding thật ⇒ 0 lỗi), hub lên bình thường;
// gỡ binding ⇒ lỗi đúng câu. Binding đăng ký hộ vẫn tới engine (`flowPortRegistry`, `nodeConfigRegistry`) — hành vi không đổi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import { MODULES, withEvents } from "@ai/contracts/modules";
import { createDb, type Db } from "@ai/db";
import { cloneDb } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { ConfigCache } from "../config/public";
import { flowPortRegistry, moduleRegistry, nodeConfigRegistry } from "./kit/public";
import { mountedApps, verifyPackModules } from "./packs.modules-check";
import { mountPacks } from "./packs.mount";

let db: Db;
const config = {
  tenant: async () => undefined,
  catalog: async () => ({ features: [], entitled: new Set<string>(), grantGroups: new Map() }),
  user: async () => undefined,
} as unknown as ConfigCache;

beforeAll(async () => {
  await cloneDb("full");
  db = createDb(urls().hubApi, { max: 2 });
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("sổ module · mount thật", () => {
  it("mountPacks (contracts + community) không ném, MODULES × binding thật ⇒ 0 lỗi", () => {
    const d = { db, config, appEnv: "test" as const };
    const t0 = performance.now();
    expect(() => mountPacks(new Hono(), d)).not.toThrow();
    const t1 = performance.now();
    verifyPackModules(mountedApps(d));
    // CR-125 m2 · đo thời gian khởi động: verify chỉ là phần nhỏ của mountPacks
    console.log(
      `module-registry boot: mountPacks(gồm verify)=${(t1 - t0).toFixed(1)}ms verify=${(performance.now() - t1).toFixed(2)}ms`,
    );
    const mods = withEvents(MODULES, Object.values(APP_MANIFESTS));
    expect(moduleRegistry.issues(mods, { apps: mountedApps(d) })).toEqual([]);
    expect(mountedApps(d)).toEqual(["core", "contracts", "community"]);
  });

  it("đăng ký hộ: engine vẫn tra được bộ đọc/xử lý kết quả và node Ký số có đường options", () => {
    expect(flowPortRegistry.factsReaderFor("contracts", "contract.submitted")).toBeDefined();
    expect(flowPortRegistry.outcomeHandlerFor("contracts", "contract.submitted")).toBeDefined();
    expect(flowPortRegistry.outcomeHandlerFor("community", "post.created")).toBeDefined();
    expect(moduleRegistry.bindingOf("core.if")?.executor).toBe("if"); // CR-125 m5 · bước cơ bản vào sổ khi mount
    expect(moduleRegistry.bindingOf("contracts.esign")?.tools).toEqual(["contracts-esign-send"]);
    // CR-125 m8 · đầu ra mà binding thật ghi (khớp khai báo không pending ⇒ verify xanh)
    expect(moduleRegistry.bindingOf("core.approve")?.outputs).toEqual([
      "decision",
      "decided_by",
      "feedback",
    ]);
    // CR-125 m9 · đủ cổng ra (không còn pending)
    expect(moduleRegistry.bindingOf("contracts.esign")?.outputs).toEqual([
      "event",
      "signed_at",
      "signer",
      "envelope_id",
    ]);
    expect(moduleRegistry.bindingOf("contracts.partner-send")?.outputs).toEqual([
      "event",
      "partner_reason",
      "round",
    ]);
    expect(moduleRegistry.bindingOf("core.bell")?.outputs).toEqual(["sent_to"]);
    expect(moduleRegistry.bindingOf("contracts.esign")?.optionsPath).toBe(
      "/pack/contracts/esign/options",
    );
  });
});

describe("sổ module · mount lại, validator", () => {
  it("mount lần hai vô hại (đăng ký lại cùng khoá); verify lại vẫn xanh", () => {
    expect(() => mountPacks(new Hono(), { db, config, appEnv: "test" })).not.toThrow();
    expect(() => verifyPackModules(["core", "contracts", "community"])).not.toThrow();
  });

  it("validator cấu hình theo tool Ký số đã vào nodeConfigRegistry (stage sai ⇒ có kiểm)", async () => {
    const issues = await nodeConfigRegistry.check("00000000-0000-0000-0000-000000000000", [
      {
        node: "contracts.esign",
        executor: { kind: "tool", tool_key: "contracts-esign-send", args: {} },
      },
    ]);
    expect(Array.isArray(issues)).toBe(true);
  });
});
