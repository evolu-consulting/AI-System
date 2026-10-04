// HUB-FR-41 · HUB-FR-42 · HUB-BR-04 · H1-R10–R12 · P11, P12 · E12/E13/E14 + SseWriter/SseReader trên hub-api thật + DB
// + Redis (hạ tầng QW-A1/A2 `tests/acceptance/H1`, chỉ đọc). Vòng chạy run = driver điều khiển tay (thay B8).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ChatEventSchema, RunSchema } from "@ai/contracts/chat";
import {
  call,
  err,
  errorOf,
  HUB_API_URL,
  type Hub,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  REDIS_TEST_URL,
  type Sql,
  sign,
  USERS,
  type UserKey,
} from "../../../../../tests/acceptance/H1/_fixtures";
import {
  idGen,
  insertConv,
  insertHubConfig,
  openSse,
  runIdOf,
  type Sse,
  send,
  sseStream,
} from "../../../../../tests/acceptance/H1/_hub";
import { createApp } from "../../app";
import { connectDb } from "../../lib/db";
import { createRedis, type Redis } from "../../lib/redis";
import { runErrorText } from "./run-errors";
import type { RunContext, RunDriver } from "./runs.service";
import { RunFencedError } from "./sse/sse-writer";

const ctxs = new Map<string, RunContext>();
const driver: RunDriver = { start: (ctx) => void ctxs.set(ctx.writer.run.id, ctx) };
const OWNER = "b6-hub";

let sql: Sql;
let k: Keys;
let hub: Hub;
let redis: Redis;
const ac = new AbortController();
const id = idGen(6000);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  const db = connectDb(HUB_API_URL, 5);
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const deps = { db, redis, jwtPublicKey: k.publicKey, appEnv: "test" as const };
  const app = createApp(
    { version: "0.0.0-test", corsOrigins: [] },
    { ...deps, instanceId: OWNER, runDriver: driver, signal: ac.signal },
  );
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  hub = {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);

async function started(who: UserKey = "lan"): Promise<{ s: Sse; ctx: RunContext; conv: string }> {
  const conv = await insertConv(sql, who, id());
  const s = await send(hub, await tok(who), conv, "Câu hỏi B6");
  expect(s.status).toBe(200);
  await s.until((e) => e.event === "run.started", 5_000);
  const ctx = ctxs.get(runIdOf(s));
  if (!ctx) throw new Error("driver chưa nhận run");
  return { s, ctx, conv };
}

const step = (ctx: RunContext, n: number) =>
  ctx.writer.emit({ event: "step.started", data: { step_id: `s${n}`, label: "Đang xử lý…" } });

describe("B6 · SseWriter kết thúc run [HUB-FR-41 · H1-R12 · P12]", () => {
  it("HUB-FR-41 · ask + run.finished: id 1..n, sse:<id> `<seq>-0`, TTL 600, last_seq, tin assistant, E14", async () => {
    const { s, ctx, conv } = await started();
    await step(ctx, 1);
    await ctx.writer.emit({ event: "delta", data: { text: "Xin " } });
    await ctx.writer.emit({ event: "delta", data: { text: "chào" } });
    const ask = { question: "Tiếp không?", choices: ["Có"] };
    expect(await ctx.writer.finish({ kind: "finished", content: "Xin chào", ask })).toBe(true);
    const end = await s.terminal();
    s.close();
    expect(end?.data?.content).toBe("Xin chào");
    expect(s.events.map((e) => e.event)).toEqual([
      "run.started",
      "step.started",
      "delta",
      "delta",
      "ask",
      "run.finished",
    ]);
    expect(s.events.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const e of s.events) expect(ChatEventSchema.safeParse(e).success).toBe(true);
    const runId = ctx.writer.run.id;
    expect((await sseStream(redis, runId)).map((x) => x.id)).toEqual(
      [1, 2, 3, 4, 5, 6].map((i) => `${i}-0`),
    );
    expect(await redis.ttl(`sse:${runId}`)).toBeGreaterThan(590);
    const [run] = await sql`select status, last_seq, owner from hub.runs where id = ${runId}`;
    expect(run).toEqual({ status: "finished", last_seq: 6, owner: OWNER });
    const [m] = await sql`select content, ask, conversation_id from hub.messages
      where id = ${ctx.writer.run.answerMessageId}`;
    expect(m).toEqual({ content: "Xin chào", ask, conversation_id: conv });
    const [f] = await sql`select pending_ask from hub.flows where id = ${ctx.writer.run.flowId}`;
    expect(f?.pending_ask).toBe(true);
    const e14 = await call(hub, "GET", `/runs/${runId}`, { token: await tok("lan") });
    expect(RunSchema.parse(e14.json)).toMatchObject({ status: "finished", last_event_id: 6 });
  });
});

describe("B6 · run.failed theo locale [HUB-BR-04 · P11]", () => {
  it("HUB-BR-04 · run.failed theo runs.locale (hoa = en) = cột error_* = E14.error [P11]", async () => {
    const { s, ctx } = await started("hoa");
    await ctx.writer.finish({ kind: "failed", code: "UPSTREAM_ERROR" });
    const end = await s.terminal();
    s.close();
    const text = runErrorText("UPSTREAM_ERROR", "en");
    expect(end?.data).toEqual({
      run_id: ctx.writer.run.id,
      message_id: ctx.writer.run.answerMessageId,
      code: "UPSTREAM_ERROR",
      ...text,
    });
    const e14 = await call(hub, "GET", `/runs/${ctx.writer.run.id}`, { token: await tok("hoa") });
    expect(e14.json.error).toEqual({ code: "UPSTREAM_ERROR", ...text });
    expect(e14.json.status).toBe("failed");
  });
});

describe("B6 · P12 + fencing [H1-R12 · P12]", () => {
  it("P12 · owner đổi (bị chiếm) → finish false, không tin assistant, không XADD kết thúc", async () => {
    const { s, ctx } = await started();
    const runId = ctx.writer.run.id;
    await sql`update hub.runs set owner = 'other-hub' where id = ${runId}`;
    expect(await ctx.writer.finish({ kind: "finished", content: "x" })).toBe(false);
    expect(ctx.writer.signal.aborted).toBe(true);
    s.close();
    expect((await sseStream(redis, runId)).length).toBe(1);
    const [n] = await sql`select count(*)::int as n from hub.messages
      where id = ${ctx.writer.run.answerMessageId}`;
    expect(n?.n).toBe(0);
    await sql`update hub.runs set status = 'failed', error_code = 'INTERNAL_ERROR', error_message = 'x',
      error_hint = '', finished_at = now() where id = ${runId}`;
  });

  it("H1-R12 · fencing: id đã bị bên khác ghi → emit ném RunFencedError, signal abort", async () => {
    const { s, ctx } = await started();
    await redis.xadd(`sse:${ctx.writer.run.id}`, "2-0", "e", JSON.stringify({ event: "x" }));
    const fenced = await step(ctx, 1).catch((e: unknown) => e);
    expect(fenced).toBeInstanceOf(RunFencedError);
    expect(ctx.writer.signal.aborted).toBe(true);
    s.close();
  });
});

describe("B6 · E13 Last-Event-ID, 410, dựng lại từ DB [HUB-FR-42 · H1-R12]", () => {
  it("HUB-FR-42 · run đang chạy: E13 header 1 → nhận sự kiện mới tới kết thúc; query dùng khi thiếu header", async () => {
    const { s, ctx } = await started();
    s.close();
    const token = await tok("lan");
    const path = `/runs/${ctx.writer.run.id}/events`;
    const live = await openSse(hub, "GET", path, { token, headers: { "Last-Event-ID": "1" } });
    await step(ctx, 1);
    await ctx.writer.finish({ kind: "finished", content: "" });
    await live.terminal();
    live.close();
    expect(live.events.map((e) => e.id)).toEqual([2, 3]);
    const q = await openSse(hub, "GET", `${path}?last_event_id=2`, { token });
    await q.terminal();
    q.close();
    expect(q.events.map((e) => e.event)).toEqual(["run.finished"]);
  });

  it("HUB-FR-42 · mất key nhưng chưa quá hạn → dựng run.failed từ cột (không 410); quá 600 s → 410", async () => {
    const { s, ctx } = await started();
    s.close();
    const runId = ctx.writer.run.id;
    await ctx.writer.finish({ kind: "failed", code: "TIMEOUT" });
    await redis.del(`sse:${runId}`);
    await sql`update hub.runs set finished_at = now() - interval '5 seconds' where id = ${runId}`;
    const token = await tok("lan");
    const again = await openSse(hub, "GET", `/runs/${runId}/events`, { token });
    const end = await again.terminal();
    again.close();
    expect(end?.data).toMatchObject({ code: "TIMEOUT", ...runErrorText("TIMEOUT", "vi") });
    await sql`update hub.runs set finished_at = now() - interval '601 seconds' where id = ${runId}`;
    expect(errorOf(await call(hub, "GET", `/runs/${runId}/events`, { token }))).toEqual(
      err("EVENTS_EXPIRED"),
    );
  });

  it("H1-R03 · E12 hội thoại người khác → 404 trước 400 body", async () => {
    const conv = await insertConv(sql, "lan", id());
    const res = await call(hub, "POST", `/conversations/${conv}/messages`, {
      token: await tok("an"),
      body: { bad: 1 },
    });
    expect(errorOf(res)).toEqual(err("NOT_FOUND"));
  });
});
