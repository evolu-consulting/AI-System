// HUB-FR-42, HUB-FR-89 · HUB-H1-AC-03, AC-04, AC-05 · H1-R12, H1-R13 · test-plan H1 §5 A39–A41, test-plan-cases §1 A54:
// nhiều instance — nối lại SSE ở instance khác, sweeper lease chiếm run của instance chết, job mồ côi, đua sweeper ∥ kết thúc.
// Readiness lần 4 #51: run của `hoa` (locale en) bị sweeper kết thúc → `runs.error_message/hint` = runErrorText(…, 'en').
// Hộp đen: HTTP 2 hub-api thật + DB `ai_system_h1_test` + Redis DB 15; test đóng vai Runtime (`_runtime.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { runErrorText } from "../../../apps/hub-api/src/modules/runs/run-errors";
import {
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  USERS,
  type UserKey,
  waitFor,
} from "./_fixtures";
import {
  deltaText,
  type HubX,
  idGen,
  insertConv,
  insertHubConfig,
  isTerminal,
  openSse,
  runIdOf,
  runRow,
  type Sse,
  send,
  sseStream,
  startHubX,
  terminalCount,
  testRedis,
} from "./_hub";
import { ScriptRuntime } from "./_runtime";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
const id = idGen(6000);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  hub = await startHubX(k, { instanceId: "qc-hub-a" });
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);
async function start(
  h: HubX,
  who: UserKey,
  content: string,
): Promise<{ s: Sse; runId: string; conv: string }> {
  const conv = await insertConv(sql, who, id());
  const s = await send(h, await tok(who), conv, content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv };
}
/** Chờ run rời `running` (≤ `ms`); trả dòng cuối. */
const settled = (runId: string, ms: number): Promise<Json> =>
  waitFor(
    () => runRow(sql, runId),
    (r) => r?.status !== "running",
    ms,
  );

describe("A39–A41, A54 · nhiều instance, lease, mồ côi [HUB-H1-AC-03 · AC-04 · AC-05]", () => {
  it("A39 · POST ở A, ngắt sau delta thứ 3, E13 ở B với Last-Event-ID → phần còn lại không lặp, không mất [HUB-H1-AC-03 · H1-R12]", async () => {
    const b = await startHubX(k, { instanceId: "qc-hub-b" });
    try {
      const x = await start(hub, "lan", "Viết dài A39");
      const text = "Đoạn văn dài cho ca nối lại ở instance khác, mỗi câu đều có nghĩa. "
        .repeat(8)
        .trim();
      await rt.decide(await rt.next(x.runId), { decision: "answer", text });
      const deltas = await waitFor(
        async () => x.s.events.filter((e) => e.event === "delta"),
        (d) => d.length >= 3,
        10_000,
      );
      const third = deltas[2];
      x.s.close();
      expect(third?.id).toBeDefined();
      const lastId = third?.id ?? 0;
      const seenA = x.s.events.filter((e) => (e.id ?? 0) <= lastId);
      const atB = await openSse(b, "GET", `/runs/${x.runId}/events`, {
        token: await tok("lan"),
        headers: { "Last-Event-ID": String(lastId) },
      });
      expect(atB.status).toBe(200);
      const end = await atB.terminal();
      atB.close();
      expect(end?.event).toBe("run.finished");
      expect(atB.events.map((e) => e.id)).toEqual(atB.events.map((_, i) => lastId + 1 + i));
      expect(deltaText([...seenA, ...atB.events])).toBe(text);
      expect(end?.data?.content).toBe(text);
    } finally {
      await b.stop();
    }
  });

  it("A40 · A dừng không dọn, lease_until lùi → B ≤ 20 s đóng run INTERNAL_ERROR (câu en của hoa), huỷ job, seq = cuối + 1; kết quả muộn không phát thêm [HUB-H1-AC-05 · #51]", async () => {
    const a = await startHubX(k, { instanceId: "qc-hub-dead" });
    let x: Awaited<ReturnType<typeof start>>;
    let job: Awaited<ReturnType<typeof rt.next>>;
    try {
      x = await start(a, "hoa", "Run của instance sắp chết");
      job = await rt.next(x.runId);
      await x.s.until((e) => e.event === "step.started", 5_000);
      x.s.close();
    } finally {
      await a.stop();
    }
    const before = await sseStream(redis, x.runId);
    await sql`update hub.runs set lease_until = now() - interval '1 second' where id = ${x.runId}`;
    const r = await settled(x.runId, 20_000);
    const t = runErrorText("INTERNAL_ERROR", "en");
    expect(r).toMatchObject({
      status: "failed",
      owner: hub.instanceId,
      error_code: "INTERNAL_ERROR",
      error_message: t.message,
      error_hint: t.hint,
    });
    const [j] =
      await sql`select status, cancel_requested_at is not null as cancel from hub.jobs where id = ${job.id}`;
    expect(j?.cancel).toBe(true);
    const after = await waitFor(
      () => sseStream(redis, x.runId),
      (s) => s.length > before.length,
      3_000,
    );
    expect(after.map((e) => e.id)).toEqual(after.map((_, i) => `${i + 1}-0`));
    expect(after.at(-1)?.ev).toMatchObject({
      event: "run.failed",
      id: before.length + 1,
      data: { code: "INTERNAL_ERROR", message: t.message, hint: t.hint },
    });
    await rt.decide(job, { decision: "answer", text: "Muộn." });
    await Bun.sleep(500);
    expect((await sseStream(redis, x.runId)).length).toBe(after.length);
  }, 60_000);

  it("A41 · heartbeat_at = now − 61 s → Hub ≤ 20 s đánh dấu job orphaned + run.failed INTERNAL_ERROR (vi); POST cùng flow sau đó không FLOW_BUSY [HUB-H1-AC-04]", async () => {
    const x = await start(hub, "lan", "Job sẽ mồ côi");
    const job = await rt.next(x.runId);
    await sql`update hub.jobs set heartbeat_at = now() - interval '61 seconds' where id = ${job.id}`;
    const e = await x.s.terminal(20_000);
    x.s.close();
    const t = runErrorText("INTERNAL_ERROR", "vi");
    expect(e?.event).toBe("run.failed");
    expect(e?.data).toMatchObject({ code: "INTERNAL_ERROR", message: t.message, hint: t.hint });
    const [j] =
      await sql`select status, error_code, error_reason from hub.jobs where id = ${job.id}`;
    expect({ ...j }).toEqual({
      status: "failed",
      error_code: "INTERNAL_ERROR",
      error_reason: "orphaned",
    });
    const flow = x.s.headers.get("x-flow-id") ?? "";
    const again = await send(hub, await tok("lan"), x.conv, "Gửi lại sau mồ côi", flow);
    expect(again.status).toBe(200);
    await rt.decide(await rt.next(runIdOf(again)), { decision: "answer", text: "Đã chạy lại." });
    expect((await again.terminal())?.event).toBe("run.finished");
    again.close();
  }, 60_000);

  it("A54 · lease lùi ngay trước lượt quét: sweeper B chiếm ∥ A nhận job.result cuối → đúng 1 sự kiện kết thúc, runs.status khớp; nếu sweeper thắng: câu en theo locale run (hoa) [HUB-H1-AC-05 · H1-R12 · #51]", async () => {
    const b = await startHubX(k, { instanceId: "qc-hub-b" });
    try {
      const x = await start(hub, "hoa", "Đua sweeper A54");
      const job = await rt.next(x.runId);
      await sql`update hub.runs set lease_until = now() - interval '1 second' where id = ${x.runId}`;
      await rt.decide(job, { decision: "answer", text: "Kết quả đua A54." });
      const r = await settled(x.runId, 20_000);
      expect(["finished", "failed"]).toContain(r?.status);
      const end = await x.s.terminal(5_000);
      x.s.close();
      expect(x.s.events.filter(isTerminal).length).toBe(1);
      // Bên thua không XADD: số sự kiện kết thúc giữ 1 sau khi bên kia có cơ hội ghi.
      const n = await waitFor(
        () => terminalCount(redis, x.runId),
        (c) => c !== 1,
        2_000,
      );
      expect(n).toBe(1);
      expect(end?.event).toBe(r?.status === "finished" ? "run.finished" : "run.failed");
      if (r?.status === "failed") {
        const t = runErrorText("INTERNAL_ERROR", "en");
        expect(r).toMatchObject({
          error_code: "INTERNAL_ERROR",
          error_message: t.message,
          error_hint: t.hint,
        });
      }
    } finally {
      await b.stop();
    }
  }, 60_000);
});
