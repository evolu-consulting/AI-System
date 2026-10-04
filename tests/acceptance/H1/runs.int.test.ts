// HUB-FR-42, HUB-FR-45 · HUB-H1-AC-03 · H1-R09–R12 · C1-R04 · test-plan H1 §5 A8–A13, A15: E12 mở run + SSE,
// FLOW_BUSY, flow mới, id SSE và `sse:<id>`, Last-Event-ID/410, nhãn step theo locale, cắt delta.
// Hộp đen: HTTP hub-api thật + DB `ai_system_h1_test` + Redis DB 15; test đóng vai Runtime (`_runtime.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ChatEventSchema, MessageSchema } from "@ai/contracts/chat";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  counts,
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
} from "./_fixtures";
import {
  deltaText,
  type HubX,
  idGen,
  insertConv,
  insertFlow,
  insertHubConfig,
  isTerminal,
  openSse,
  runIdOf,
  runRow,
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
const id = idGen(1000);

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

/** E12 trên hội thoại mới của `who`, Orchestrator trả `answer` = `text`; chờ sự kiện kết thúc. */
async function answered(who: UserKey, content: string, text: string) {
  const conv = await insertConv(sql, who, id());
  const s = await send(hub, await tok(who), conv, content);
  expect(s.status).toBe(200);
  const runId = runIdOf(s);
  const job = await rt.next(runId);
  await rt.decide(job, { decision: "answer", text });
  const end = await s.terminal();
  expect(end?.event).toBe("run.finished");
  s.close();
  return { s, runId, conv, flowId: s.headers.get("x-flow-id") ?? "" };
}

async function assistantOf(conv: string, flowId: string, who: UserKey = "lan"): Promise<Json> {
  const res = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${flowId}`, {
    token: await tok(who),
  });
  expect(res.status).toBe(200);
  const items: Json[] = res.json?.items ?? [];
  return items.find((m) => m.role === "assistant");
}

describe("A8–A10 · E12 mở run [HUB-FR-42 · HUB-FR-45]", () => {
  it("A8 · run.started (id 1, quota {ok,0}) tới trước khi Runtime trả job Orchestrator; header X-Run-Id/Flow-Id/Message-Id khớp DB [H1-R10]", async () => {
    const conv = await insertConv(sql, "lan", id());
    const s = await send(hub, await tok("lan"), conv, "Xin chào A8");
    expect(s.status).toBe(200);
    expect(s.headers.get("content-type") ?? "").toContain("text/event-stream");
    const runId = runIdOf(s);
    const flowId = s.headers.get("x-flow-id");
    const msgId = s.headers.get("x-message-id");
    const started = await s.until((e) => e.event === "run.started", 5_000);
    expect(started).toEqual({
      id: 1,
      event: "run.started",
      data: { run_id: runId, flow_id: flowId, quota: { state: "ok", pct: 0 } },
    });
    expect(await runRow(sql, runId)).toMatchObject({
      status: "running",
      flow_id: flowId,
      conversation_id: conv,
      user_message_id: msgId,
    });
    // Job Orchestrator chưa được trả: stream chưa có sự kiện kết thúc.
    const job = await rt.next(runId);
    expect(s.events.some(isTerminal)).toBe(false);
    await rt.decide(job, { decision: "answer", text: "Chào bạn, mình là trợ lý." });
    expect((await s.terminal())?.event).toBe("run.finished");
    s.close();
  });

  it("A9 · POST vào flow đang chạy → 409 FLOW_BUSY, không ghi gì [H1-R11]", async () => {
    const before = await counts(sql);
    const res = await call(hub, "POST", `/conversations/${R.conv}/messages`, {
      token: await tok("lan"),
      body: { content: "Chen ngang", flow_id: R.flow2 },
    });
    expect(errorOf(res)).toEqual(err("FLOW_BUSY"));
    expect(await counts(sql)).toEqual(before);
  });

  it("A9 · 2 POST song song cùng flow rảnh → đúng một 200, một 409 FLOW_BUSY [H1-R11]", async () => {
    const conv = await insertConv(sql, "lan", id());
    const flow = await insertFlow(sql, "lan", conv, id(), {
      msgs: [
        { role: "user", content: "Câu trước" },
        { role: "assistant", content: "Trả lời trước" },
      ],
    });
    const token = await tok("lan");
    const [a, b] = await Promise.all([
      send(hub, token, conv, "Song song 1", flow),
      send(hub, token, conv, "Song song 2", flow),
    ]);
    const ok = [a, b].filter((x) => x.status === 200);
    const busy = [a, b].filter((x) => x.status !== 200);
    expect(ok.length).toBe(1);
    expect(busy.map((x) => x.json?.error?.code)).toEqual(["FLOW_BUSY"]);
    const [r] = await sql<
      { n: number }[]
    >`select count(*)::int as n from hub.runs where flow_id = ${flow}`;
    expect(r?.n).toBe(1);
    const winner = ok[0];
    if (winner) {
      const job = await rt.next(runIdOf(winner));
      await rt.decide(job, { decision: "answer", text: "Xong." });
      await winner.terminal();
      winner.close();
    }
  });

  it("A10 · không flow_id → flow mới thuộc hội thoại; flow_id của hội thoại khác → 404 không ghi gì [HUB-FR-45]", async () => {
    const conv = await insertConv(sql, "lan", id());
    const flowsBefore = await sql`select id from hub.flows where conversation_id = ${conv}`;
    const { flowId } = await (async () => {
      const s = await send(hub, await tok("lan"), conv, "Mở flow mới");
      expect(s.status).toBe(200);
      const job = await rt.next(runIdOf(s));
      await rt.decide(job, { decision: "answer", text: "Đã mở." });
      await s.terminal();
      s.close();
      return { flowId: s.headers.get("x-flow-id") ?? "" };
    })();
    expect(flowsBefore.length).toBe(0);
    const [f] = await sql`select conversation_id from hub.flows where id = ${flowId}`;
    expect(f?.conversation_id).toBe(conv);

    const before = await counts(sql);
    const res = await call(hub, "POST", `/conversations/${conv}/messages`, {
      token: await tok("lan"),
      body: { content: "Sai flow", flow_id: R.flow },
    });
    expect(errorOf(res)).toEqual(err("NOT_FOUND"));
    expect(await counts(sql)).toEqual(before);
  });
});

describe("A11–A12 · id SSE, sse:<id>, Last-Event-ID, 410 [H1-R12 · HUB-FR-42]", () => {
  it("A11 · id SSE 1..n liên tục, mọi frame hợp ChatEventSchema; sse:<id> id <seq>-0; xong: TTL ∈ (590, 600], run:<id> bị xoá [H1-R12]", async () => {
    const { s, runId } = await answered(
      "lan",
      "Kể chuyện A11",
      "Một câu chuyện ngắn cho ca A11. ".repeat(4),
    );
    const ids = s.events.map((e) => e.id);
    expect(ids).toEqual(s.events.map((_, i) => i + 1));
    for (const e of s.events) expect(ChatEventSchema.safeParse(e).success).toBe(true);
    const stream = await sseStream(redis, runId);
    expect(stream.map((x) => x.id)).toEqual(ids.map((i) => `${i}-0`));
    const ttl = await redis.ttl(`sse:${runId}`);
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
    expect(await redis.exists(`run:${runId}`)).toBe(0);
  });

  it("A12 · Last-Event-ID: 3 → 4…n như stream gốc; finished_at lùi 601 s + mất key → 410 EVENTS_EXPIRED [H1-R12]", async () => {
    const { s, runId } = await answered(
      "lan",
      "Viết đoạn A12",
      "Đoạn văn dài để có nhiều sự kiện delta. ".repeat(5),
    );
    expect(s.events.length).toBeGreaterThan(4);
    const token = await tok("lan");
    const again = await openSse(hub, "GET", `/runs/${runId}/events`, {
      token,
      headers: { "Last-Event-ID": "3" },
    });
    expect(again.status).toBe(200);
    await again.terminal();
    again.close();
    expect(again.events).toEqual(s.events.filter((e) => (e.id ?? 0) > 3));

    await sql`update hub.runs set finished_at = now() - interval '601 seconds' where id = ${runId}`;
    await redis.del(`sse:${runId}`);
    const gone = await call(hub, "GET", `/runs/${runId}/events`, { token });
    expect(errorOf(gone)).toEqual(err("EVENTS_EXPIRED"));
  });
});

describe("A13, A15 · nhãn step theo locale, cắt delta [C1-R04 · H1-R09]", () => {
  const LABELS = {
    lan: ["Đang phân tích yêu cầu…", "Đang xử lý…"],
    hoa: ["Analyzing your request…", "Working on it…"],
  } as const;

  for (const who of ["lan", "hoa"] as const) {
    it(`A13 · ${who} (${USERS[who].locale}) → nhãn step tĩnh theo locale; không frame nào chứa key agent/provider [C1-R04 · HUB-FR-20]`, async () => {
      const conv = await insertConv(sql, who, id());
      const s = await send(hub, await tok(who), conv, "Nhờ trợ lý giúp");
      expect(s.status).toBe(200);
      const runId = runIdOf(s);
      const orch = await rt.next(runId);
      await rt.decide(orch, { decision: "delegate", agent: "assistant", task: "Giúp người dùng" });
      const ag = await rt.next(runId);
      await rt.agent(ag, { status: "done", text: "Đã giúp xong việc được nhờ." });
      expect((await s.terminal())?.event).toBe("run.finished");
      s.close();
      const labels = s.events.filter((e) => e.event === "step.started").map((e) => e.data?.label);
      expect(labels).toEqual([...LABELS[who]]);
      const frames = JSON.stringify(s.events);
      for (const leak of ["orchestrator", "assistant", "fake-cli", "claude-sub", "fake-1"])
        expect(frames).not.toContain(leak);
    });
  }

  it("A15 · answer 130 ký tự → ≥ 4 delta, mỗi delta ≤ 40 ký tự; nối = run.finished.content = tin E11 [H1-R09]", async () => {
    const text =
      "Tổng số hoá đơn tháng chín là mười hai, trong đó ba hoá đơn chưa thanh toán và chín hoá đơn đã đối soát xong với ngân hàng.";
    const t130 = `${text}${"!".repeat(130 - [...text].length)}`;
    expect([...t130].length).toBe(130);
    const { s, conv, flowId } = await answered("lan", "Tổng hoá đơn?", t130);
    const deltas = s.events.filter((e) => e.event === "delta").map((e) => String(e.data?.text));
    expect(deltas.length).toBeGreaterThanOrEqual(4);
    for (const d of deltas) expect([...d].length).toBeLessThanOrEqual(40);
    expect(deltaText(s.events)).toBe(t130);
    expect(s.events.at(-1)?.data?.content).toBe(t130);
    const msg = await assistantOf(conv, flowId);
    expect(MessageSchema.safeParse(msg).success).toBe(true);
    expect(msg?.content).toBe(t130);
  });
});
