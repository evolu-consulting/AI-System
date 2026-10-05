// HUB-FR-91 · H2b-R30 · HUB-H2b-AC-13 · test-plan H2b §5, cases §2 A150: tương thích — tin không bắt đầu `@`/`/` giữ hình
// H2a: `run.started` đúng khoá `{run_id, flow_id, quota}` (không `responder`), tin E11 cùng tập khoá H2a (không
// `responder`), không `delta` nào trước khi job có kết quả (job không phát `job.delta`). Xanh trước code (hành vi H2a).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type Json, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { deltaText, type HubX, insertConv, runIdOf, send, testRedis } from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import { settleRuns, setupH2b, startHubH2b } from "./_h2b";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

/** Tập khoá `Message` H2a (C1, trước H2b). */
const H2A_MESSAGE_KEYS = [
  "ask",
  "content",
  "conversation_id",
  "created_at",
  "flow_id",
  "id",
  "role",
  "run",
  "run_id",
];

describe("A150 · tin thường giữ hình H2a [H2b-R30 · HUB-H2b-AC-13]", () => {
  it("HUB-FR-91 · A150 · tin không @// → run.started khoá đúng {run_id, flow_id, quota}; E11 cùng tập khoá H2a; không delta trước job.result; nối delta = content [H2b-R30]", async () => {
    const token = await sign(k, USERS.lan);
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const s = await send(hub, token, conv, "Xin chào A150");
    try {
      expect(s.status).toBe(200);
      const runId = runIdOf(s);
      const started = await s.until((e) => e.event === "run.started", 5_000);
      expect(Object.keys(started?.data ?? {}).sort()).toEqual(["flow_id", "quota", "run_id"]);
      const job = await rt.next(runId);
      await rt.progress(job);
      await s.until((e) => e.event === "step.started", 5_000);
      expect(s.events.filter((e) => e.event === "delta")).toEqual([]);
      const d = echoAnswer(job);
      await rt.decide(job, d);
      const end = await s.terminal(15_000);
      expect(end?.event).toBe("run.finished");
      expect(deltaText(s.events)).toBe(end?.data?.content);
      const flowId = s.headers.get("x-flow-id") ?? "";
      const res = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${flowId}`, {
        token,
      });
      expect(res.status).toBe(200);
      for (const m of (res.json?.items ?? []) as Json[])
        expect(Object.keys(m).sort()).toEqual(H2A_MESSAGE_KEYS);
    } finally {
      s.close();
    }
  });
});
