// HUB-FR-92 · HUB-FR-94 · WRK-FR-03 · ngân sách spec H2b §6 / plan §7 (test-plan H2b §5, cases §2 PF1–PF3; không chặn mốc,
// chạy bằng `bun run test:perf`): `GET /agents` p95 ≤ 50 ms (200 lần, cache); E12 `@` + kiểm 429 thêm ≤ 10 ms p95 so với
// tin thường (thời gian tới header SSE); `job.delta` → SSE `delta` p95 ≤ 150 ms.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { type HubX, insertConv, runIdOf, runRow, send, testRedis } from "../H1/_hub";
import { ScriptRuntime3, settleRuns, setupH2b, startHubH2b } from "./_h2b";
import { answer, arrival, deltasOf, quantile, startRun } from "./_stream";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime3;
let token = "";

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime3(sql, redis);
  token = await sign(k, USERS.lan);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

/** Thời gian tới header phản hồi E12 (SSE mở hoặc lỗi JSON) rồi dọn run. */
async function sendMs(content: string): Promise<{ ms: number; runId: string; status: number }> {
  const conv = await insertConv(sql, "lan", crypto.randomUUID());
  const t0 = performance.now();
  const s = await send(hub, token, conv, content);
  const ms = performance.now() - t0;
  s.close();
  const runId = runIdOf(s);
  await settleRuns(hub, sql, k);
  return { ms, runId, status: s.status };
}

describe("PF1–PF3 · hiệu năng H2b [spec §6 · plan §7]", () => {
  it("HUB-FR-92 · PF1 · GET /agents p95 ≤ 50 ms (200 lần, 0 query — cache) [spec §6]", async () => {
    expect((await call(hub, "GET", "/agents", { token })).status).toBe(200);
    const xs: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      const res = await call(hub, "GET", "/agents", { token });
      xs.push(performance.now() - t0);
      expect(res.status).toBe(200);
    }
    expect(quantile(xs, 0.95)).toBeLessThanOrEqual(50);
  }, 60_000);

  it("HUB-FR-94 · PF2 · E12 '@assistant …' (router @ + kiểm 429) thêm ≤ 10 ms p95 so với tin thường [spec §6 · plan §7]", async () => {
    const first = await sendMs("@assistant Đo PF2");
    expect(first.status).toBe(200);
    expect((await runRow(sql, first.runId))?.kind).toBe("direct");
    const plain: number[] = [];
    const tagged: number[] = [];
    for (let i = 0; i < 30; i++) {
      plain.push((await sendMs(`Tin thường PF2 ${i}`)).ms);
      tagged.push((await sendMs(`@assistant Tin gắn tag PF2 ${i}`)).ms);
    }
    expect(quantile(tagged, 0.95) - quantile(plain, 0.95)).toBeLessThanOrEqual(10);
  }, 120_000);

  it("WRK-FR-03 · PF3 · XADD job.delta → SSE delta p95 ≤ 150 ms (20 chunk) [spec §6]", async () => {
    const x = await startRun(hub, sql, token, { who: "lan", content: "Đo PF3" });
    const job = await rt.next(x.runId);
    const lat: number[] = [];
    const parts = Array.from({ length: 20 }, (_, i) => `Mẩu ${i} PF3. `);
    for (const [i, p] of parts.entries()) {
      const t0 = Date.now();
      await rt.delta(job, "answer", p);
      lat.push((await arrival(() => deltasOf(x.s).length >= i + 1, 1_000)) - t0);
    }
    await rt.decide(job, answer(parts.join("")));
    await x.s.terminal(10_000);
    x.s.close();
    await settleRuns(hub, sql, k);
    expect(quantile(lat, 0.95)).toBeLessThanOrEqual(150);
  }, 60_000);
});
