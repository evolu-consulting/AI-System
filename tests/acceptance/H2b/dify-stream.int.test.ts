// WRK-FR-03 · HUB-FR-91 · HUB-H2b-AC-11 · H2b-R24 · plan P14 · test-plan H2b §5, cases §2 A120–A123: agent Dify do Hub gọi
// trực tiếp (`DifyAgentRunner`) phát `job.delta{done}` tổng hợp mỗi chunk Dify khi job được stream — run `@dify-tro-ly`
// (`direct`) và delegate đầu `dify-tom` thấy `delta` trước khi MK gửi chunk cuối (`mk-slow-300`, 5 chunk); delegate thứ 2
// không stream; SSE id liên tục, chỉ sự kiện thuộc `CHAT_EVENT_NAMES`. Catalog H2a + mock Dify (MK) trong tiến trình.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { CHAT_EVENT_NAMES, ChatEventSchema } from "@ai/contracts/chat";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { type Json, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { deltaText, type HubX, isTerminal, testRedis } from "../H1/_hub";
import type { Job } from "../H1/_runtime";
import { type Dify, setAppKey, startDify } from "../H2a/_h2a";
import { MOCK_TEXT } from "../H2a/_h2a2";
import { ScriptRuntime3, settleRuns, setupH2b, startHubH2b } from "./_h2b";
import {
  answer,
  arrival,
  expectDeltaBeforeStepEnd,
  expectNoDelta,
  isDelta,
  jobCount,
  type Run,
  startRun,
  stepIdOf,
} from "./_stream";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime3;
let dify: Dify;

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2b({ catalogBaseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime3(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

/** 5 chunk × 300 ms: delta đầu phải tới trước kết thúc ít nhất ~2 nhịp chunk. */
const SLOW = "mk-slow-300";
const EARLY_MS = 600;

const start = async (content: string): Promise<Run> =>
  startRun(hub, sql, await sign(k, USERS.lan), { who: "lan", content });
async function nextAs(x: Run, role: "orchestrator" | "agent"): Promise<Job> {
  const job = await rt.next(x.runId);
  expect(job.payload.agent.role).toBe(role);
  return job;
}
async function finish(x: Run): Promise<Json> {
  const end = await x.s.terminal(20_000);
  x.s.close();
  expect(end?.event).toBe("run.finished");
  return end?.data;
}
async function responderKey(x: Run): Promise<string | undefined> {
  return (await x.s.until((e) => e.event === "run.started", 5_000))?.data?.responder?.key;
}
/** Mốc delta đầu và kết thúc run (đồng hồ test) — đăng ký trước khi Dify chạy. */
const timing = (x: Run) => ({
  first: arrival(() => x.s.events.some(isDelta), 20_000),
  end: arrival(() => x.s.events.some(isTerminal), 20_000),
});

describe("A120–A123 · Dify stream qua delta [HUB-H2b-AC-11 · H2b-R24 · P14]", () => {
  it("WRK-FR-03 · A120 · '@dify-tro-ly hỏi' (mk-slow-300, 5 chunk) → responder.key=dify-tro-ly; ≥ 1 delta trước run.finished, delta đầu sớm hơn kết thúc ≥ 600 ms (trước chunk cuối); content = nối chunk [HUB-H2b-AC-11 · H2b-R24]", async () => {
    await setAppKey(sql, "troLy", SLOW);
    const x = await start("@dify-tro-ly hỏi về lịch nghỉ A120");
    const t = timing(x);
    expect(await responderKey(x)).toBe("dify-tro-ly");
    const end = await finish(x);
    expect(end?.content).toBe(MOCK_TEXT);
    expect(deltaText(x.s.events)).toBe(MOCK_TEXT);
    expect((await t.end) - (await t.first)).toBeGreaterThanOrEqual(EARLY_MS);
  });

  it("WRK-FR-03 · A121 · Orchestrator delegate dify-tom (delegate đầu, mk-slow-300) → delta khi step delegate còn mở, pass-through, đúng 1 job Orchestrator [H2b-R24 · H2b-R22]", async () => {
    await setAppKey(sql, "tom", SLOW);
    const x = await start("Nhờ dify-tom tóm tắt A121");
    const t = timing(x);
    await rt.decide(await nextAs(x, "orchestrator"), {
      decision: "delegate",
      agent: "dify-tom",
      task: "Tóm tắt văn bản A121",
    });
    expect((await finish(x))?.content).toBe(MOCK_TEXT);
    expectDeltaBeforeStepEnd(x.s, await stepIdOf(sql, x.runId, "delegate"));
    expect(deltaText(x.s.events)).toBe(MOCK_TEXT);
    expect((await t.end) - (await t.first)).toBeGreaterThanOrEqual(EARLY_MS);
    expect(await jobCount(sql, x.runId, "orchestrator")).toBe(1);
  });

  it("WRK-FR-03 · A122 · dify-tom là delegate thứ 2 (mk-slow-300) → 0 delta từ nó; content = answer Orchestrator [H2b-R24 · H2b-R22]", async () => {
    await setAppKey(sql, "tom", SLOW);
    const x = await start("Hai việc A122");
    await rt.decide(await nextAs(x, "orchestrator"), {
      decision: "delegate",
      agent: "assistant",
      task: "Việc 1 A122",
    });
    await rt.agent(await nextAs(x, "agent"), { status: "partial", text: "Nửa", missing: "nửa" });
    await rt.decide(await nextAs(x, "orchestrator"), {
      decision: "delegate",
      agent: "dify-tom",
      task: "Tóm tắt A122",
    });
    await expectNoDelta(x.s, 1_200);
    const o3 = await nextAs(x, "orchestrator");
    expect(x.s.events.filter(isDelta)).toEqual([]);
    await rt.decide(o3, answer("Kết luận A122."));
    expect((await finish(x))?.content).toBe("Kết luận A122.");
    expect(deltaText(x.s.events)).toBe("Kết luận A122.");
  });

  it("WRK-FR-03 · A123 · run '@dify-tro-ly' (mk-agent) → SSE id 1..n liên tục, mọi sự kiện thuộc CHAT_EVENT_NAMES + hợp ChatEventSchema [P14 · H1-R12]", async () => {
    await setAppKey(sql, "troLy", "mk-agent");
    const x = await start("@dify-tro-ly hỏi A123");
    expect(await responderKey(x)).toBe("dify-tro-ly");
    expect((await finish(x))?.content).toBe(MOCK_TEXT);
    expect(x.s.events.map((e) => e.id)).toEqual(x.s.events.map((_, i) => i + 1));
    for (const e of x.s.events) {
      expect(CHAT_EVENT_NAMES as readonly string[]).toContain(e.event);
      expect(ChatEventSchema.safeParse(e).success).toBe(true);
    }
    expect(x.s.events.some(isDelta)).toBe(true);
  });
});
