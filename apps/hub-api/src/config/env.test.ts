// HUB-NFR-04 · env hub-api (plan H1 §7): mặc định, chuỗi rỗng = vắng, lỗi chỉ nêu tên biến.
import { describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import { loadEnv } from "./env";

const PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAsecretvalue\n-----END PUBLIC KEY-----";
const base = {
  APP_ENV: "development",
  HUB_DATABASE_URL: "postgres://hub_api:hub_api_dev_pw@localhost:5432/ai_system",
  REDIS_URL: "redis://localhost:6379",
  JWT_PUBLIC_KEY: PEM,
};

describe("hub-api env", () => {
  test("HUB-NFR-04 · mặc định theo plan §7", () => {
    const env = loadEnv({ ...base, HUB_INSTANCE_ID: "", HUB_CORS_ORIGINS: "" });
    expect(env.HUB_PORT).toBe(4000);
    expect(env.HUB_JOB_MAX_WAIT_S).toBe(30);
    expect(env.HUB_CONFIG_POLL_S).toBe(60);
    expect(env.HUB_CORS_ORIGINS).toEqual(["http://localhost:3100"]);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.HUB_INSTANCE_ID).toBe(`${hostname()}:${process.pid}`);
  });

  test("HUB-NFR-04 · đọc giá trị đặt sẵn, CORS nhiều origin", () => {
    const env = loadEnv({
      ...base,
      HUB_PORT: "4100",
      HUB_INSTANCE_ID: "hub-a",
      HUB_CORS_ORIGINS: "http://a.test, http://b.test",
      LOG_LEVEL: "debug",
    });
    expect(env.HUB_PORT).toBe(4100);
    expect(env.HUB_INSTANCE_ID).toBe("hub-a");
    expect(env.HUB_CORS_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
    expect(env.LOG_LEVEL).toBe("debug");
  });

  test("HUB-NFR-04 · sai/thiếu → lỗi liệt kê tên biến, không in giá trị", () => {
    const bad = {
      ...base,
      JWT_PUBLIC_KEY: "secretvalue",
      REDIS_URL: "http://x",
      HUB_DATABASE_URL: undefined,
    };
    let msg = "";
    try {
      loadEnv(bad);
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("JWT_PUBLIC_KEY");
    expect(msg).toContain("REDIS_URL");
    expect(msg).toContain("HUB_DATABASE_URL");
    expect(msg).not.toContain("secretvalue");
  });
});
