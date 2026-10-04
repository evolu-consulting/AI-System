// HUB-FR-43 · HUB-H1-AC-H06 · UC-04 · H1-R14 · test-plan H1 §5 A34–A36, test-plan-cases §1 A55: huỷ run (E15, E9) —
// job `queued`/`running`, NOTIFY `job_cancel`, SSE `run.failed CANCELLED`, idempotent, huỷ từ instance không phải chủ.
// Hộp đen: HTTP hub-api thật (2 instance khi cần) + DB `ai_system_h1_test` + Redis DB 15; test đóng vai Runtime.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { JobCancelPayloadSchema } from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { runErrorText } from "../../../apps/hub-api/src/modules/runs/run-errors";
import {
  call,
  err,
  errorOf,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  sign,
  USERS,
  type UserKey,
  waitFor,
} from "./_fixtures";
import {
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
  testRedis,
} from "./_hub";
import { ScriptRuntime } from "./_runtime";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
const id = idGen(4000);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  hub = await startHubX(k);
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
  who: UserKey = "lan",
  h: HubX = hub,
): Promise<{ s: Sse; runId: string; conv: string }> {
  const conv = await insertConv(sql, who, id());
  const s = await send(h, await tok(who), conv, "Việc sẽ bị huỷ");
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv };
}
const cancel = async (runId: string, h: HubX = hub, who: UserKey = "lan") =>
  call(h, "POST", `/runs/${runId}/cancel`, { token: await tok(who) });
const jobsOf = (runId: string) =>
  sql<{ id: string; status: string; cancelled: boolean }[]>`select id, status,
    cancel_requested_at is not null as cancelled from hub.jobs where run_id = ${runId} order by created_at`;

/** Sự kiện kết thúc `run.failed CANCELLED` với câu lỗi theo locale của run. */
function expectCancelled(e: Json, who: UserKey): void {
  expect(e?.event).toBe("run.failed");
  const t = runErrorText("CANCELLED", USERS[who].locale);
  expect(e?.data).toMatchObject({ code: "CANCELLED", message: t.message, hint: "" });
}

describe("A34–A36 · huỷ run [HUB-FR-43 · HUB-H1-AC-H06]", () => {
  it("A34 · job queued → cancelled; SSE run.failed CANCELLED ≤ 5 s; run cancelled + error_* theo locale [HUB-H1-AC-H06]", async () => {
    const { s, runId } = await start("lan");
    expect(await rt.peek(runId)).toBeDefined();
    const res = await cancel(runId);
    expect(res.status).toBe(200);
    expect(res.json?.id).toBe(runId);
    const e = await s.terminal(5_000);
    s.close();
    expectCancelled(e, "lan");
    expect((await jobsOf(runId)).map((j) => j.status)).toEqual(["cancelled"]);
    const t = runErrorText("CANCELLED", "vi");
    expect(await runRow(sql, runId)).toMatchObject({
      status: "cancelled",
      error_code: "CANCELLED",
      error_message: t.message,
      error_hint: "",
    });
  });

  it("A34 · job running → cancel_requested_at + NOTIFY job_cancel; E15 lần 2 → 200, không sự kiện mới [HUB-H1-AC-H06]", async () => {
    const listener = ownerSql();
    const notes: Json[] = [];
    const sub = await listener.listen("job_cancel", (raw) => {
      try {
        notes.push(JSON.parse(raw));
      } catch {
        notes.push(raw);
      }
    });
    try {
      const { s, runId } = await start("hoa");
      const job = await rt.next(runId);
      expect((await cancel(runId, hub, "hoa")).status).toBe(200);
      expectCancelled(await s.terminal(5_000), "hoa");
      s.close();
      expect([...(await jobsOf(runId))]).toEqual([
        { id: job.id, status: "running", cancelled: true },
      ]);
      const n = await waitFor(
        async () => notes.filter((x) => x?.job_id === job.id),
        (a) => a.length > 0,
        3_000,
      );
      expect(n.length).toBe(1);
      expect(JobCancelPayloadSchema.safeParse(n[0]).success).toBe(true);
      expect(n[0]?.run_id).toBe(runId);

      const len = (await sseStream(redis, runId)).length;
      const again = await cancel(runId, hub, "hoa");
      expect(again.status).toBe(200);
      expect(again.json?.status).toBe("cancelled");
      // Runtime trả kết quả muộn: Hub không phát thêm gì.
      await rt.decide(job, { decision: "answer", text: "Muộn." });
      await Bun.sleep(500);
      expect((await sseStream(redis, runId)).length).toBe(len);
    } finally {
      await sub.unlisten();
      await listener.end();
    }
  });

  it("A35 · E9 xoá hội thoại có run đang chạy → run cancelled (SSE CANCELLED), rồi hội thoại 404 [HUB-FR-43 · E9]", async () => {
    const { s, runId, conv } = await start("lan");
    await rt.next(runId);
    const del = await call(hub, "DELETE", `/conversations/${conv}`, { token: await tok("lan") });
    expect(del.status).toBe(204);
    expectCancelled(await s.terminal(5_000), "lan");
    s.close();
    expect((await runRow(sql, runId))?.status).toBe("cancelled");
    expect((await jobsOf(runId)).map((j) => j.cancelled)).toEqual([true]);
    expect(
      errorOf(await call(hub, "GET", `/conversations/${conv}`, { token: await tok("lan") })),
    ).toEqual(err("NOT_FOUND"));
  });

  it("A36 · huỷ run đã xong → 200 status finished, không đổi gì [UC-04]", async () => {
    const before = await runRow(sql, R.runDone);
    const len = (await sseStream(redis, R.runDone)).length;
    const res = await cancel(R.runDone);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: R.runDone, status: "finished", error: null });
    expect(await runRow(sql, R.runDone)).toEqual(before);
    expect((await sseStream(redis, R.runDone)).length).toBe(len);
  });
});

describe("A55 · huỷ ở instance không phải chủ [HUB-FR-43 · H1-R14]", () => {
  it("A55 · run chủ A, E15 gửi tới B khi A đang phát sự kiện → SSE ở A và B đều kết thúc bằng đúng 1 run.failed CANCELLED, id liên tục; E15 lần 2 ở A → 200, không sự kiện mới [HUB-H1-AC-H06]", async () => {
    const b = await startHubX(k, { instanceId: "qc-hub-b" });
    try {
      const { s, runId } = await start("lan", hub);
      const job = await rt.next(runId);
      await rt.progress(job, "đang đọc tài liệu");
      const atB = await openSse(b, "GET", `/runs/${runId}/events`, { token: await tok("lan") });
      expect(atB.status).toBe(200);
      const [res] = await Promise.all([cancel(runId, b), rt.progress(job, "vẫn đang chạy")]);
      expect(res.status).toBe(200);
      for (const conn of [s, atB]) {
        const e = await conn.terminal(5_000);
        conn.close();
        expectCancelled(e, "lan");
        expect(conn.events.filter(isTerminal).length).toBe(1);
        expect(conn.events.at(-1)?.event).toBe("run.failed");
      }
      expect(s.events.map((e) => e.id)).toEqual(s.events.map((_, i) => i + 1));
      const stream = await sseStream(redis, runId);
      expect(stream.map((x) => x.id)).toEqual(stream.map((_, i) => `${i + 1}-0`));
      expect(
        stream.filter((x) => ["run.finished", "run.failed"].includes(x.ev?.event)).length,
      ).toBe(1);

      // Kết quả muộn tới chủ A + E15 lần 2 ở A: không sự kiện mới.
      await rt.decide(job, { decision: "answer", text: "Muộn." });
      const again = await cancel(runId, hub);
      expect(again.status).toBe(200);
      await Bun.sleep(500);
      expect((await sseStream(redis, runId)).length).toBe(stream.length);
    } finally {
      await b.stop();
    }
  });
});
