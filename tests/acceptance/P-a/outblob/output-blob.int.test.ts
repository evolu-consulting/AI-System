// HUB-FR-106 · HUB-FR-115 · WRK-BR-06 · CR-056 D5 · bug "output stage không có blob": engine ghi `hub.attachments`
// (origin=output) nhưng không ghi nội dung vào file store ⇒ stage kế `GET /internal/jobs/:id/attachments/:attId` 404.
// Hợp đồng: sau khi stage 0 xong, blob của attachment output ĐỌC ĐƯỢC từ store (đúng nội dung + sha256 + size), và stage 1
// tải được qua endpoint nội bộ bằng token job. Hub dựng với `attachments.storage` local tạm (như outputs-review.int.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import type { AttachmentStorage } from "../../../../apps/hub-api/src/modules/attachments/storage";
import { createLocalStorage } from "../../../../apps/hub-api/src/modules/attachments/storage.local";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { ScriptRuntime } from "../../H1/_runtime";
import { newJobToken, tokenHash } from "../../H2a/_runtime2";
import { api, type CtxPa, type Json, PA, setupPa } from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  DEFS,
  jobDone,
  MD_AUTO,
  MD_OK,
  nextStageJob,
  outputs,
  review,
  seedPf1,
  startInRoom,
  toGate,
} from "../pf1/_local";

let c: CtxPa;
let dir: string;
let storage: AttachmentStorage;

beforeAll(async () => {
  const { sql, ready } = await setupPa();
  if (ready) await seedPf1(sql);
  const k = await makeKeys();
  dir = await mkdtemp(join(tmpdir(), "pa-outblob-"));
  storage = await createLocalStorage({ dir });
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId: "qc-outblob-1",
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 4,
    processEngine: true,
    processLoops: false,
    attachments: { storage, tenantMaxBytes: 1_073_741_824, sweepS: 600, sweep: false },
  } as unknown as HubDeps & Record<string, unknown>;
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const rtRedis = await testRedis();
  const base = `http://localhost:${server.port}`;
  const tok = (r: Parameters<CtxPa["tok"]>[0]) => sign(k, PA[r]);
  c = {
    sql,
    ready,
    k,
    hub: { base, db, redis, instanceId: "qc-outblob-1", handles: () => null, kicks: [] } as never,
    redis: rtRedis,
    rt: new ScriptRuntime(sql, rtRedis),
    tok,
    call: async (r, method, path, body) => api(c.hub, await tok(r), method, path, body),
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      rtRedis.disconnect();
      await db.close();
      await sql.end();
    },
  };
}, 60_000);
afterAll(async () => {
  await c?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

describe("OUTBLOB · blob output stage đọc được từ store [HUB-FR-106]", () => {
  it("HUB-FR-106 · OUTBLOB-1 · stage 0 xong ⇒ attachment output có blob trong store (nội dung, sha256, size khớp)", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c, { key: DEFS.auto.key });
    await jobDone(c, await nextStageJob(c, s.runId), MD_AUTO);
    const out = await waitOutput(s.runId, 0);
    expect(out.attachment_id).toBeTruthy();
    const [att] = await c.sql<
      Json[]
    >`select * from hub.attachments where id = ${out.attachment_id}`;
    expect(att?.origin).toBe("output");
    const blob = await storage.blob(att?.storage_key, "text/markdown");
    expect(blob).not.toBeNull();
    const text = await (blob as Blob).text();
    expect(text).toBe(out.content);
    expect(text).toBe(MD_AUTO);
    expect(att?.sha256).toBe(sha(text));
    expect(Number(att?.size)).toBe(Buffer.byteLength(text, "utf8"));
    expect((await storage.open(att?.storage_key))?.size).toBe(Number(att?.size));
  }, 30_000);

  it("HUB-FR-115 · OUTBLOB-2 · stage 1 tải được output stage 0 (đã duyệt) qua GET /internal/jobs/:id/attachments/:attId (200, đúng nội dung)", async () => {
    needSchema(c.ready);
    const g = await toGate(c);
    expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
    const out0 = await waitOutput(g.runId, 0);
    const j1 = await nextStageJob(c, g.runId);
    const token = newJobToken();
    await c.sql`update hub.jobs set token_hash = ${tokenHash(token)} where id = ${j1.id}`;
    const ids = ((j1.payload as { attachments?: { id: string }[] }).attachments ?? []).map(
      (a) => a.id,
    );
    expect(ids).toContain(out0.attachment_id);
    const res = await fetch(
      `${c.hub.base}/internal/jobs/${j1.id}/attachments/${out0.attachment_id}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(MD_OK);
  }, 40_000);
});

async function waitOutput(runId: string, idx: number): Promise<Json> {
  const end = Date.now() + 8_000;
  for (;;) {
    const o = (await outputs(c.sql, runId)).find((r) => r.stage_idx === idx);
    if (o || Date.now() > end) {
      expect(o).toBeDefined();
      return o as Json;
    }
    await Bun.sleep(100);
  }
}
