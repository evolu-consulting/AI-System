// CR-103 · fnr-unfreeze · int (viết TRƯỚC code, Luật 1b — quyền): chế độ route công khai quy trình `off | admin | all`.
// `admin`: chỉ mount defs/runs/gates/usage sau `requireAdminRole` (member 403, admin 200); hộp việc/asks/nguồn/phòng vẫn 404.
// `all` (= HUB_FROZEN_MODULES=on, mặc định test in-process) và `off` (= module đóng băng tắt) giữ hành vi cũ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  type HubDeps,
  REDIS_TEST_URL,
} from "../../../../../tests/acceptance/H1/_fixtures";
import {
  api,
  type CtxPa,
  type PA,
  PA_FIX,
  startPa,
} from "../../../../../tests/acceptance/P-a/_support/pa";
import { createApp } from "../../app";
import { connectDb, pingDb } from "../../lib/db";
import { createRedis, pingRedis } from "../../lib/redis";

type Hub = { base: string; stop: () => Promise<void> };

/** Hub thật in-process (engine bật, vòng nền tắt) với `frozenModules`/`processRoutes` tuỳ chọn. */
async function startHub(
  c: CtxPa,
  extra: Record<string, unknown>,
  instanceId: string,
): Promise<Hub> {
  const db = connectDb(HUB_API_URL, 4);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: c.k.publicKey,
    appEnv: "test",
    instanceId,
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    processEngine: true,
    processLoops: false,
    stageLauncher: { kick: async () => {} },
    ...extra,
  } as HubDeps & Record<string, unknown>;
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

let c: CtxPa; // chế độ `all` (mặc định in-process)
let admin: Hub; // frozenModules:false + processRoutes:"admin"
let off: Hub; // frozenModules:false, không đặt processRoutes ⇒ off
beforeAll(async () => {
  c = await startPa();
  admin = await startHub(c, { frozenModules: false, processRoutes: "admin" }, "qc-fnr-admin");
  off = await startHub(c, { frozenModules: false }, "qc-fnr-off");
}, 60_000);
afterAll(async () => {
  await off?.stop();
  await admin?.stop();
  await c?.stop();
});

const st = async (h: Hub, who: keyof typeof PA, method: string, path: string, body?: unknown) => ({
  path,
  s: (await api(h as never, await c.tok(who), method, path, body)).status,
});

describe("CR-103 fnr-unfreeze · chế độ route quy trình", () => {
  it("admin: member ⇒ 403 trên /process-defs, /process-runs, /process-runs/:id, quyết định review", async () => {
    const run = `/process-runs/${PA_FIX.defHoaDon}`;
    for (const [m, p, b] of [
      ["GET", "/process-defs"],
      ["GET", "/process-runs"],
      ["GET", run],
      ["POST", `/review-tasks/${PA_FIX.defHoaDon}/decision`, { result: "pass" }],
    ] as const)
      expect(await st(admin, "A", m, p, b)).toEqual({ path: p, s: 403 });
  });

  it("admin: tenant_admin + platform_admin ⇒ 200 trên /process-defs và /process-runs", async () => {
    for (const who of ["Adm", "P"] as const) {
      expect(await st(admin, who, "GET", "/process-defs?limit=1")).toEqual({
        path: "/process-defs?limit=1",
        s: 200,
      });
      expect(await st(admin, who, "GET", "/process-runs?scope=tenant")).toEqual({
        path: "/process-runs?scope=tenant",
        s: 200,
      });
    }
  });

  it("admin: route đóng băng vẫn 404 với admin (hộp việc chat-web, asks, nguồn, phòng)", async () => {
    const id = PA_FIX.defHoaDon;
    for (const [m, p, b] of [
      ["GET", "/me/process-inbox"],
      ["GET", "/me/review-tasks"],
      ["POST", `/review-tasks/${id}/answer`, { answer: "x" }],
      ["GET", "/admin/sources"],
      ["GET", "/rooms"],
    ] as const)
      expect(await st(admin, "Adm", m, p, b)).toEqual({ path: p, s: 404 });
  });

  it("off (frozenModules:false, không đặt chế độ): như cũ ⇒ 404 cả admin", async () => {
    expect(await st(off, "Adm", "GET", "/process-defs")).toEqual({ path: "/process-defs", s: 404 });
    expect(await st(off, "A", "GET", "/process-runs")).toEqual({ path: "/process-runs", s: 404 });
  });

  it("all (mặc định in-process): như cũ ⇒ member dùng /process-runs + hộp việc 200", async () => {
    expect(await st(c.hub, "A", "GET", "/process-runs")).toEqual({ path: "/process-runs", s: 200 });
    expect(await st(c.hub, "A", "GET", "/me/process-inbox")).toEqual({
      path: "/me/process-inbox",
      s: 200,
    });
    expect(await st(c.hub, "A", "GET", "/process-defs")).toEqual({ path: "/process-defs", s: 403 });
  });
});
