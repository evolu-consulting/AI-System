// HUB-FR-138 · HUB-FR-98 · hạ tầng int FB1 cho phòng/nhóm (X2b-2): như `X2b2/_x2b2.ts startX2b2` nhưng `attachments.storage` = driver FileBox
// (giả `_fbfake.ts`). Đặt riêng để không sửa helper X2b2 đã khoá. Không chứa `it(...)`.
import { createApp } from "../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../apps/hub-api/src/lib/redis";
import {
  HUB_API_URL,
  type HubDeps,
  type Keys,
  makeKeys,
  REDIS_TEST_URL,
  sign,
} from "../H1/_fixtures";
import { testRedis } from "../H1/_hub";
import { ScriptRuntime } from "../H1/_runtime";
import { rmDir, tempDir } from "../H2c/_h2c";
import { P } from "../X2a/_x2a";
import { type CtxX, type HubX2b2, setupX2b2, TENANT_MAX } from "../X2b2/_x2b2";
import { buildFbStorage, type FbFake } from "./_fb1";

export async function startHubX2b2Fb(k: Keys, fake: FbFake): Promise<HubX2b2> {
  const dir = await tempDir("fb1room");
  const { storage, error } = await buildFbStorage({ fake });
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = "qc-fb1-room";
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId,
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    attachments: storage
      ? { storage, tenantMaxBytes: TENANT_MAX, sweepS: 600, sweep: false }
      : undefined,
  } as HubDeps & Record<string, unknown>;
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId,
    dir,
    storage,
    storageError: error,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
      await rmDir(dir);
    },
  } as HubX2b2;
}

export async function startX2b2Fb(fake: FbFake): Promise<CtxX> {
  const sql = await setupX2b2();
  const k = await makeKeys();
  const hub = await startHubX2b2Fb(k, fake);
  const redis = await testRedis();
  const rt = new ScriptRuntime(sql, redis);
  return {
    sql,
    k,
    hub,
    redis,
    rt,
    tok: (w) => sign(k, P[w]),
    stop: async () => {
      await hub.stop();
      redis.disconnect();
      await sql.end();
    },
  } as CtxX;
}
