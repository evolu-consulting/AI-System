// F1 (CR-095) · cờ module đóng băng của hub-api (docs/platform/modules.md): mặc định off từ env; off ⇒ không mount `/rooms*`.
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mountX2a } from "./app.x2a";
import { loadEnv } from "./config/env";
import { envAppDeps } from "./config/env-deps";
import type { Db } from "./lib/db";
import { logger } from "./lib/logger";

const PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAsecretvalue\n-----END PUBLIC KEY-----";
const base = {
  APP_ENV: "development",
  HUB_DATABASE_URL: "postgres://hub_api:hub_api_dev_pw@localhost:5432/ai_system",
  REDIS_URL: "redis://localhost:6379",
  JWT_PUBLIC_KEY: PEM,
};
const deps = (env: Record<string, string>) => envAppDeps(loadEnv({ ...base, ...env }), logger);

describe("F1 · HUB_FROZEN_MODULES", () => {
  test("vắng ⇒ off; on ⇒ frozenModules true", () => {
    expect(deps({}).frozenModules).toBe(false);
    expect(deps({ HUB_FROZEN_MODULES: "on" }).frozenModules).toBe(true);
  });

  test("rooms:false ⇒ /rooms 404; mặc định ⇒ route có mặt (khác 404)", async () => {
    const mount = (rooms?: boolean) => {
      const app = new Hono();
      app.onError((_e, c) => c.text("lỗi handler (không có user)", 500)); // route có mặt nhưng chưa qua auth
      mountX2a(app, { db: {} as Db, log: logger, ...(rooms === undefined ? {} : { rooms }) });
      return app;
    };
    expect((await mount(false).request("/rooms")).status).toBe(404);
    expect((await mount().request("/rooms")).status).not.toBe(404);
  });
});
