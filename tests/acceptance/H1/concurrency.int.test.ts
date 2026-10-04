// HUB-FR-42, HUB-FR-43 · plan H1 §3.5 (thứ tự khoá) · test-plan H1 §5 A37, A38, test-plan-cases §1 A37b: E12 ∥ kết thúc ∥ huỷ,
// E12 ∥ E8 ∥ E9, huỷ ∥ sweeper ∥ kết thúc — không deadlock, mỗi run đúng một sự kiện kết thúc, ≤ 1 run `running` mỗi flow.
// Hộp đen: HTTP hub-api thật + DB `ai_system_h1_test` + Redis DB 15; test đóng vai Runtime (`_runtime.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Res,
  type Sql,
  sign,
  USERS,
  waitFor,
} from "./_fixtures";
import {
  type HubX,
  idGen,
  insertConv,
  insertFlow,
  insertHubConfig,
  pgDeadlocks,
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
let token: string;
const id = idGen(5000);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  hub = await startHubX(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
  token = await sign(k, USERS.lan);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

const post = (conv: string, content: string, flow?: string): Promise<Res> =>
  call(hub, "POST", `/conversations/${conv}/messages`, {
    token,
    body: flow ? { content, flow_id: flow } : { content },
  });
const cancel = (runId: string) => call(hub, "POST", `/runs/${runId}/cancel`, { token });
const runIdOf = (r: Res) => r.headers.get("x-run-id") ?? "";

/** Runtime kịch bản: nhận job Orchestrator của run rồi trả `answer` (kết thúc bình thường). */
async function finishBy(runId: string): Promise<void> {
  const job = await rt.tryNext(runId, 3_000);
  if (job) await rt.decide(job, { decision: "answer", text: "Kết thúc bình thường." });
}

/** Mọi run đã kết thúc trong DB và mỗi run có đúng một sự kiện kết thúc trong `sse:<id>`. */
async function expectSettled(runIds: string[]): Promise<void> {
  const rows = await waitFor(
    () =>
      sql<
        { id: string; status: string }[]
      >`select id, status from hub.runs where id = any(${sql.array(runIds, 2950)})`,
    (rs) => rs.length === runIds.length && rs.every((r) => r.status !== "running"),
    15_000,
  );
  expect(rows.filter((r) => r.status === "running")).toEqual([]);
  for (const r of runIds) expect(await terminalCount(redis, r)).toBe(1);
}

describe("A37, A37b, A38 · đua giữa các transaction ghi [plan §3.5 · HUB-FR-43]", () => {
  it("A37 · 50 vòng E12 ∥ kết thúc ∥ huỷ cùng flow: deadlocks không tăng, mỗi run 1 kết thúc, ≤ 1 running/flow [HUB-FR-42 · HUB-FR-43]", async () => {
    const conv = await insertConv(sql, "lan", id());
    const flow = await insertFlow(sql, "lan", conv, id(), {
      msgs: [
        { role: "user", content: "Mở đầu" },
        { role: "assistant", content: "Chào" },
      ],
    });
    const d0 = await pgDeadlocks(sql);
    const runs: string[] = [];
    let current = "";
    for (let i = 0; i < 50; i++) {
      if (!current) {
        const first = await post(conv, `Vòng ${i}`, flow);
        expect(first.status).toBe(200);
        current = runIdOf(first);
        runs.push(current);
      }
      const run = current;
      const [, , next] = await Promise.all([
        finishBy(run),
        cancel(run),
        post(conv, `Vòng ${i} tiếp`, flow),
      ]);
      expect([200, 409]).toContain(next.status);
      current = next.status === 200 ? runIdOf(next) : "";
      if (current) runs.push(current);
      const [busy] = await sql<{ n: number }[]>`select count(*)::int as n from hub.runs
        where flow_id = ${flow} and status = 'running'`;
      expect(busy?.n ?? 0).toBeLessThanOrEqual(1);
    }
    if (current) await cancel(current);
    await expectSettled(runs);
    expect(await pgDeadlocks(sql)).toBe(d0);
  }, 180_000);

  it("A37b · 50 vòng E12 ∥ E8 ∥ E9 cùng hội thoại (Runtime giữ job): không deadlock; E12 200 → run huỷ CANCELLED, E12 404 → không messages/runs; không run mồ côi [plan §3.5 · E8 · E9]", async () => {
    const d0 = await pgDeadlocks(sql);
    const created: string[] = [];
    const convs: string[] = [];
    for (let i = 0; i < 50; i++) {
      const conv = await insertConv(sql, "lan", id(), `Hội thoại đua ${i}`);
      convs.push(conv);
      const [send, rename, del] = await Promise.all([
        post(conv, `Tin đua ${i}`),
        call(hub, "PATCH", `/conversations/${conv}`, { token, body: { title: `Đổi tên ${i}` } }),
        call(hub, "DELETE", `/conversations/${conv}`, { token }),
      ]);
      expect(del.status).toBe(204);
      expect([200, 404]).toContain(rename.status);
      expect([200, 404]).toContain(send.status);
      const [c] = await sql<{ msgs: number; runs: number }[]>`select
        (select count(*)::int from hub.messages where conversation_id = ${conv}) as msgs,
        (select count(*)::int from hub.runs where conversation_id = ${conv}) as runs`;
      if (send.status === 200) {
        created.push(runIdOf(send));
        expect(c?.runs).toBe(1);
      } else expect(c).toEqual({ msgs: 0, runs: 0 });
    }
    await expectSettled(created);
    const rs = await sql<
      { status: string; code: string | null }[]
    >`select status, error_code as code
      from hub.runs where id = any(${sql.array(created, 2950)})`;
    for (const r of rs) expect(r).toEqual({ status: "cancelled", code: "CANCELLED" });
    const [orphan] = await sql<{ n: number }[]>`select count(*)::int as n from hub.runs r
      join hub.conversations c on c.id = r.conversation_id
      where c.id = any(${sql.array(convs, 2950)}) and r.status = 'running'`;
    expect(orphan?.n).toBe(0);
    expect(await pgDeadlocks(sql)).toBe(d0);
  }, 180_000);

  it("A38 · 20 vòng huỷ ∥ kết thúc cùng run (sweeper chạy nền): đúng 1 sự kiện kết thúc, DB khớp sự kiện [plan §3.5 · §5.8]", async () => {
    const d0 = await pgDeadlocks(sql);
    const runs: string[] = [];
    for (let i = 0; i < 20; i++) {
      const conv = await insertConv(sql, "lan", id());
      const res = await post(conv, `Đua huỷ ${i}`);
      expect(res.status).toBe(200);
      const run = runIdOf(res);
      runs.push(run);
      const job = await rt.next(run);
      await Promise.all([rt.decide(job, { decision: "answer", text: "Đua." }), cancel(run)]);
    }
    await expectSettled(runs);
    for (const run of runs) {
      const [r] = await sql<{ status: string }[]>`select status from hub.runs where id = ${run}`;
      const evs = await redis.xrange(`sse:${run}`, "-", "+");
      const last = JSON.parse(evs.at(-1)?.[1]?.[1] ?? "null");
      expect(last?.event).toBe(r?.status === "finished" ? "run.finished" : "run.failed");
    }
    expect(await pgDeadlocks(sql)).toBe(d0);
  }, 120_000);
});
