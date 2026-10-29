// CR-103 · fnr-unfreeze · unit: chọn chế độ route công khai quy trình + đọc `HUB_PROCESS_ROUTES` từ env.
import { describe, expect, test } from "bun:test";
import { loadEnv } from "../../config/env";
import { envAppDeps } from "../../config/env-deps";
import { logger } from "../../lib/logger";
import { resolveProcessRoutes } from "./routes-mode";

const PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAsecretvalue\n-----END PUBLIC KEY-----";
const deps = (env: Record<string, string>) =>
  envAppDeps(
    loadEnv({
      APP_ENV: "development",
      HUB_DATABASE_URL: "postgres://hub_api:pw@localhost:5432/ai_system",
      REDIS_URL: "redis://localhost:6379",
      JWT_PUBLIC_KEY: PEM,
      ...env,
    }),
    logger,
  );

describe("CR-103 · resolveProcessRoutes", () => {
  test("vắng chế độ ⇒ theo cờ đóng băng (vắng/true ⇒ all, false ⇒ off)", () => {
    expect(resolveProcessRoutes({})).toBe("all");
    expect(resolveProcessRoutes({ frozenModules: true })).toBe("all");
    expect(resolveProcessRoutes({ frozenModules: false })).toBe("off");
  });
  test("đặt rõ ⇒ thắng cờ đóng băng", () => {
    expect(resolveProcessRoutes({ frozenModules: false, processRoutes: "admin" })).toBe("admin");
    expect(resolveProcessRoutes({ frozenModules: true, processRoutes: "off" })).toBe("off");
  });
});

describe("CR-103 · HUB_PROCESS_ROUTES", () => {
  test("vắng ⇒ không đặt (prod hiện tại = off); admin ⇒ processRoutes admin", () => {
    expect(resolveProcessRoutes(deps({}))).toBe("off");
    expect(deps({ HUB_PROCESS_ROUTES: "admin" }).processRoutes).toBe("admin");
    expect(resolveProcessRoutes(deps({ HUB_PROCESS_ROUTES: "admin" }))).toBe("admin");
  });
  test("giá trị lạ ⇒ lỗi env", () => {
    expect(() => deps({ HUB_PROCESS_ROUTES: "members" })).toThrow();
  });
});
