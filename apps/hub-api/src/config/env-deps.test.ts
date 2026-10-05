// HUB-NFR-04 · H2a plan §8 · env → deps của `createApp` (REVIEW 1 Hub #1, #10): `HUB_INTERNAL_TOKEN` tới `internalToken`,
// `HUB_PUBLIC_INTERNAL_URL` chỉ có mặc định ở development/test; production vắng → MCP tắt + cảnh báo một lần.
import { describe, expect, test } from "bun:test";
import { DEV_PUBLIC_INTERNAL_URL, loadEnv } from "./env";
import { attachEnvOf, envAppDeps } from "./env-deps";

const PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAsecretvalue\n-----END PUBLIC KEY-----";
const base = {
  APP_ENV: "development",
  HUB_DATABASE_URL: "postgres://hub_api:hub_api_dev_pw@localhost:5432/ai_system",
  REDIS_URL: "redis://localhost:6379",
  JWT_PUBLIC_KEY: PEM,
};
const TOKEN = "t".repeat(32);

function recorder() {
  const warns: { msg: string; fields?: Record<string, unknown> }[] = [];
  return {
    warns,
    log: { warn: (msg: string, fields?: Record<string, unknown>) => warns.push({ msg, fields }) },
  };
}

describe("hub-api env → deps", () => {
  test("HUB_INTERNAL_TOKEN → internalToken; mọi biến H2a tới deps", () => {
    const env = loadEnv({
      ...base,
      HUB_INTERNAL_TOKEN: TOKEN,
      HUB_PUBLIC_INTERNAL_URL: "http://hub.internal:4000",
      HUB_DIFY_TIMEOUT_MAX_S: "120",
      HUB_INSTANCE_ID: "hub-a",
    });
    const r = recorder();
    const deps = envAppDeps(env, r.log);
    expect(deps.internalToken).toBe(TOKEN);
    expect(deps.publicInternalUrl).toBe("http://hub.internal:4000");
    expect(deps.difyTimeoutMaxS).toBe(120);
    expect(deps.instanceId).toBe("hub-a");
    expect(deps.appEnv).toBe("development");
    expect(r.warns).toEqual([]);
  });

  test("HUB_INTERNAL_TOKEN < 32 ký tự → env lỗi nêu tên biến, không in giá trị", () => {
    expect(() => loadEnv({ ...base, HUB_INTERNAL_TOKEN: "short-secret" })).toThrow(
      /HUB_INTERNAL_TOKEN/,
    );
    try {
      loadEnv({ ...base, HUB_INTERNAL_TOKEN: "short-secret" });
    } catch (err) {
      expect((err as Error).message).not.toContain("short-secret");
    }
  });

  test("vắng HUB_INTERNAL_TOKEN → internalToken undefined (route 503)", () => {
    const deps = envAppDeps(loadEnv(base), recorder().log);
    expect(deps.internalToken).toBeUndefined();
  });
});

describe("hub-api env → deps · HUB_PUBLIC_INTERNAL_URL", () => {
  test("development/test vắng HUB_PUBLIC_INTERNAL_URL → mặc định localhost, không cảnh báo", () => {
    for (const APP_ENV of ["development", "test"]) {
      const r = recorder();
      const deps = envAppDeps(loadEnv({ ...base, APP_ENV }), r.log);
      expect(deps.publicInternalUrl).toBe(DEV_PUBLIC_INTERNAL_URL);
      expect(r.warns).toEqual([]);
    }
  });

  test("production vắng HUB_PUBLIC_INTERNAL_URL → không crash, MCP tắt + cảnh báo đúng một lần", () => {
    const r = recorder();
    const deps = envAppDeps(loadEnv({ ...base, APP_ENV: "production" }), r.log);
    expect(deps.publicInternalUrl).toBeUndefined();
    expect(r.warns.map((w) => w.msg)).toEqual(["mcp_disabled"]);
  });

  test("production có HUB_PUBLIC_INTERNAL_URL → giữ nguyên", () => {
    const env = loadEnv({
      ...base,
      APP_ENV: "production",
      HUB_PUBLIC_INTERNAL_URL: "https://hub.example:4000",
    });
    expect(envAppDeps(env, recorder().log).publicInternalUrl).toBe("https://hub.example:4000");
  });
});

describe("hub-api env → deps · HUB_MAX_CONCURRENT_RUNS (H2b R16, L1)", () => {
  test("vắng / trống → 2 (server luôn điền); hợp lệ → số", () => {
    expect(envAppDeps(loadEnv(base), recorder().log).maxConcurrentRuns).toBe(2);
    const empty = loadEnv({ ...base, HUB_MAX_CONCURRENT_RUNS: "" });
    expect(envAppDeps(empty, recorder().log).maxConcurrentRuns).toBe(2);
    const twenty = loadEnv({ ...base, HUB_MAX_CONCURRENT_RUNS: "20" });
    expect(envAppDeps(twenty, recorder().log).maxConcurrentRuns).toBe(20);
  });

  test("sai (0, 21, abc) → envAppDeps ném (server.ts thoát ≠ 0)", () => {
    for (const bad of ["0", "21", "abc"]) {
      const env = loadEnv({ ...base, HUB_MAX_CONCURRENT_RUNS: bad });
      expect(() => envAppDeps(env, recorder().log), bad).toThrow(/HUB_MAX_CONCURRENT_RUNS/);
    }
  });
});

describe("HUB_ATTACH_* → attachEnvOf (H2c R04, spec-decisions B1-1)", () => {
  test("vắng cả driver lẫn dir ngoài production → null + cảnh báo; production → ném", () => {
    const r = recorder();
    expect(attachEnvOf(loadEnv(base), r.log, "linux")).toBeNull();
    expect(r.warns.map((w) => w.msg)).toEqual(["attachments_disabled"]);
    const empty = loadEnv({ ...base, HUB_ATTACH_DRIVER: "", HUB_ATTACH_DIR: "" });
    expect(attachEnvOf(empty, recorder().log, "linux")).toBeNull();
    const prod = loadEnv({ ...base, APP_ENV: "production" });
    expect(() => attachEnvOf(prod, recorder().log, "linux")).toThrow(/HUB_ATTACH_DRIVER/);
  });

  test("có một biến → kiểm chặt; hợp lệ → cấu hình (mặc định 5 GiB / 600 s)", () => {
    const onlyDir = loadEnv({ ...base, HUB_ATTACH_DIR: "/srv/a" });
    expect(() => attachEnvOf(onlyDir, recorder().log, "linux")).toThrow(/HUB_ATTACH_DRIVER/);
    const rel = loadEnv({ ...base, HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: "rel/x" });
    expect(() => attachEnvOf(rel, recorder().log, "linux")).toThrow(/HUB_ATTACH_DIR/);
    const ok = loadEnv({ ...base, HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: "/srv/a" });
    const r = recorder();
    expect(attachEnvOf(ok, r.log, "linux")).toEqual({
      driver: "local",
      dir: "/srv/a",
      tenantMaxBytes: 5_368_709_120,
      sweepS: 600,
    });
    expect(r.warns).toEqual([]);
  });
});
