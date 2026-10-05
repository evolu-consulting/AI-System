// HUB-FR-91 · AC-H17 · HUB-BR-06 · H2b-R06–R10 · plan §5.2, P1, P10, P17 · plan-errors §2 · test-plan H2b §5, cases §2
// A20–A31: `@agent` một tag → run `kind='direct'` (bỏ qua Orchestrator): đúng 1 job agent + 1 step `delegate`, `responder`
// chốt lúc tạo run (`run.started`, E10, E11; không E14, không ở run `orchestrated`/`command`), `partial` → câu tĩnh theo
// locale, `need_input` → `ask` + tin kế qua Orchestrator (`last_agent`/`waiting_for`), lỗi job → `run.failed`, history theo
// Orchestrator đã chọn, `payload.stream=true`, session, snapshot. Catalog H2a + mock Dify (MK) cho `/dich` (A21, A30).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { runErrorText, runErrorTextFor } from "../../../apps/hub-api/src/modules/runs/run-errors";
import {
  call,
  type Json,
  type Keys,
  makeKeys,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import {
  AG,
  block,
  type HubX,
  hubConfigChange,
  insertConv,
  insertFlow,
  runIdOf,
  runRow,
  type Sse,
  send,
  testRedis,
} from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import { type Dify, startDify } from "../H2a/_h2a";
import { R08 } from "../H3a/_r08";
import {
  ASSISTANT_NAME,
  dropTenantOrch,
  jobsOf,
  settleRuns,
  setupH2b,
  startHubH2b,
  tenantOrch,
} from "./_h2b";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
let dify: Dify;

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2b({ catalogBaseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);
type Run = { s: Sse; runId: string; conv: string; flowId: string };

async function start(who: UserKey, content: string, conv?: string, flow?: string): Promise<Run> {
  const c = conv ?? (await insertConv(sql, who, crypto.randomUUID()));
  const s = await send(hub, await tok(who), c, content, flow);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv: c, flowId: s.headers.get("x-flow-id") ?? "" };
}
/** Run `direct`: job đầu tiên phải là job agent (không phải Orchestrator). */
async function startDirect(who: UserKey, content: string, conv?: string, flow?: string) {
  const x = await start(who, content, conv, flow);
  const job = await rt.next(x.runId);
  expect(job.payload.agent.role).toBe("agent");
  return { ...x, job };
}
async function finish(x: Run, event = "run.finished"): Promise<Json> {
  const end = await x.s.terminal(15_000);
  x.s.close();
  expect(end?.event).toBe(event);
  return end?.data;
}
const startedOf = (x: Run) => x.s.until((e) => e.event === "run.started", 5_000);
async function e11(who: UserKey, conv: string, flowId: string): Promise<Json[]> {
  const res = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${flowId}`, {
    token: await tok(who),
  });
  expect(res.status).toBe(200);
  return res.json?.items ?? [];
}
const assistantMsg = async (who: UserKey, x: Run) =>
  (await e11(who, x.conv, x.flowId)).find((m) => m.role === "assistant");
async function e10Answer(who: UserKey, x: Run): Promise<Json> {
  const res = await call(hub, "GET", `/conversations/${x.conv}/flows`, { token: await tok(who) });
  expect(res.status).toBe(200);
  return (res.json?.items ?? []).find((f: Json) => f.id === x.flowId)?.preview?.answer;
}
const RESP_VI = { key: "assistant", name: ASSISTANT_NAME.vi };
const FORBIDDEN_KEYS = ["agent", "provider", "model", "usage"];
function expectNoForbiddenKeys(v: Json): void {
  for (const key of Object.keys(v ?? {})) expect(FORBIDDEN_KEYS).not.toContain(key);
}

describe("A20–A22 · run direct, responder [AC-H17 · H2b-R06 · H2b-R10]", () => {
  it("HUB-FR-91 · A20 · lan '@assistant Tóm tắt X' → run.started.responder {assistant, Trợ lý}; runs kind=direct, agent_id, responder_*; 1 job agent (prompt không tag), 0 job Orchestrator, 1 step delegate; done → content; flows.agent_id; tin user lưu nguyên văn [AC-H17 · H2b-R06 · H2b-R10]", async () => {
    const x = await start("lan", "@assistant Tóm tắt X");
    expect((await startedOf(x))?.data?.responder).toEqual(RESP_VI);
    const job = await rt.next(x.runId);
    expect(job.payload.agent).toEqual({ id: AG.assistant, key: "assistant", role: "agent" });
    expect(job.payload.prompt).toContain("Tóm tắt X");
    expect(job.payload.prompt).not.toContain("@assistant");
    await rt.agent(job, { status: "done", text: "Bản tóm tắt X của trợ lý." });
    expect((await finish(x))?.content).toBe("Bản tóm tắt X của trợ lý.");
    expect(await runRow(sql, x.runId)).toMatchObject({
      kind: "direct",
      agent_id: AG.assistant,
      responder_key: "assistant",
      responder_name: ASSISTANT_NAME.vi,
      orchestrator_tenant_id: null,
    });
    expect(await jobsOf(sql, x.runId)).toEqual([{ role: "agent", key: "assistant" }]);
    const steps = await sql`select type from hub.run_steps where run_id = ${x.runId}`;
    expect(steps.map((s) => s.type)).toEqual(["delegate"]);
    const [f] = await sql`select agent_id from hub.flows where id = ${x.flowId}`;
    expect(f?.agent_id).toBe(AG.assistant);
    const user = (await e11("lan", x.conv, x.flowId)).find((m) => m.role === "user");
    expect(user?.content).toBe("@assistant Tóm tắt X");
  });

  it("HUB-FR-91 · A21 · E11/E10 của run direct có responder, E14 không; run orchestrated (2 tag) và command (/dich) không có responder ở run.started/E10/E11; không khoá agent/provider/model/usage [H2b-R10 · CHAT-AC-30]", async () => {
    const d = await startDirect("lan", "@assistant Câu A21");
    await rt.agent(d.job, { status: "done", text: "Trả lời A21." });
    await finish(d);
    expect((await assistantMsg("lan", d))?.responder).toEqual(RESP_VI);
    expect((await e10Answer("lan", d))?.responder).toEqual(RESP_VI);
    const e14 = await call(hub, "GET", `/runs/${d.runId}`, { token: await tok("lan") });
    expect(e14.status).toBe(200);
    expect(Object.keys(e14.json ?? {})).not.toContain("responder");
    for (const e of d.s.events) expectNoForbiddenKeys(e.data);

    const o = await start("lan", "@assistant @helper so sánh A21");
    const oj = await rt.next(o.runId);
    expect(oj.payload.agent.role).toBe("orchestrator");
    await rt.decide(oj, echoAnswer(oj));
    await finish(o);
    const c = await start("lan", "/dich en xin chào A21");
    await finish(c);
    for (const x of [o, c]) {
      expect("responder" in ((await startedOf(x))?.data ?? {})).toBe(false);
      expect("responder" in ((await assistantMsg("lan", x)) ?? {})).toBe(false);
      expect("responder" in ((await e10Answer("lan", x)) ?? {})).toBe(false);
      for (const e of x.s.events) expectNoForbiddenKeys(e.data);
    }
  });

  it("HUB-BR-06 · A22 · run xong rồi đổi tên + thu hồi grant assistant → E11 vẫn 'Trợ lý'; hoa (en) → 'Assistant' [H2b-R10 · HUB-BR-06]", async () => {
    const h = await startDirect("hoa", "@assistant Hello A22");
    await rt.agent(h.job, { status: "done", text: "Hi A22." });
    await finish(h);
    expect((await assistantMsg("hoa", h))?.responder).toEqual({
      key: "assistant",
      name: ASSISTANT_NAME.en,
    });
    const x = await startDirect("lan", "@assistant Câu A22");
    await rt.agent(x.job, { status: "done", text: "Trả lời A22." });
    await finish(x);
    await hubConfigChange(sql, async (tx) => {
      await tx`update hub.agents set name = ${tx.json({ vi: "Tên mới", en: "New name" })}
        where id = ${AG.assistant}`;
      await tx`delete from hub.agent_grants where agent_id = ${AG.assistant}
        and subject_id = ${USERS.lan.id}`;
    });
    try {
      expect((await assistantMsg("lan", x))?.responder).toEqual(RESP_VI);
    } finally {
      await hubConfigChange(sql, async (tx) => {
        await tx`update hub.agents set name = ${tx.json(ASSISTANT_NAME)} where id = ${AG.assistant}`;
        await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
          values (${AG.assistant}, ${T.acme}, 'user', ${USERS.lan.id})`;
      });
    }
  });
});

describe("A23–A25 · kết quả run direct [H2b-R07 · H2b-R08]", () => {
  for (const [who, want] of [
    ["lan", "A\n\nPhần chưa làm được: B"],
    ["hoa", "A\n\nNot done yet: B"],
  ] as const)
    it(`HUB-FR-91 · A23 · ${who}: partial{A, B} → content ${JSON.stringify(want)}; 0 job Orchestrator [H2b-R07]`, async () => {
      const x = await startDirect(who, "@assistant Làm việc A23");
      await rt.agent(x.job, { status: "partial", text: "A", missing: "B" });
      expect((await finish(x))?.content).toBe(want);
      expect((await jobsOf(sql, x.runId)).map((j) => j.role)).toEqual(["agent"]);
    });

  it("HUB-FR-91 · A24 · need_input → SSE ask, run finished, flows.agent_id = assistant, pending_ask; tin kế không tag → job Orchestrator, last_agent/waiting_for = assistant [AC-H17 · H2b-R07 · H2b-R08]", async () => {
    const x = await startDirect("lan", "@assistant Đặt lịch A24");
    const ask = { question: "Chọn A hay B?", choices: ["A", "B"] };
    await rt.agent(x.job, { status: "need_input", ...ask });
    await finish(x);
    expect(x.s.events.find((e) => e.event === "ask")?.data).toEqual(ask);
    expect((await runRow(sql, x.runId))?.status).toBe("finished");
    const [f] = await sql`select agent_id, pending_ask from hub.flows where id = ${x.flowId}`;
    expect(f).toMatchObject({ agent_id: AG.assistant, pending_ask: true });
    const y = await start("lan", "Chọn A", x.conv, x.flowId);
    const orch = await rt.next(y.runId);
    expect(orch.payload.agent.role).toBe("orchestrator");
    expect(JSON.parse(block(orch.payload.prompt, "flow_hint") ?? "null")).toMatchObject({
      last_agent: "assistant",
      waiting_for: "assistant",
    });
    await rt.decide(orch, echoAnswer(orch));
    await finish(y);
  });

  // T1 (H3a QW, `plan` H3a P11 · R19): BA HUB-BR-04 / H3a-R08 thắng — EXHAUSTED + reason `quota` ⇒ câu hết hạn mức
  // (`runErrorTextFor`), không còn câu H1 `runErrorText`; `TIMEOUT` giữ nguyên. Lý do: H3a `test-plan-log.md` "Tranh chấp test T1".
  for (const code of ["ALL_PROVIDERS_EXHAUSTED", "TIMEOUT"] as const)
    it(`HUB-FR-91 · A25 · job.failed ${code} → run.failed ${code}, message theo (code, reason); 0 job Orchestrator [H2b-R07 · H3a-R08]`, async () => {
      const x = await startDirect("lan", `@assistant Việc lỗi ${code}`);
      const reason = code === "ALL_PROVIDERS_EXHAUSTED" ? "quota" : null;
      await rt.fail(x.job, code, "lỗi gốc", reason);
      const data = await finish(x, "run.failed");
      expect(data?.code).toBe(code);
      if (code === "ALL_PROVIDERS_EXHAUSTED") {
        expect(data?.message).toBe(runErrorTextFor(code, "vi", reason).message);
        expect(data?.message).toBe(R08.quota.vi.message);
      } else expect(data?.message).toBe(runErrorText(code, "vi").message);
      expect((await jobsOf(sql, x.runId)).map((j) => j.role)).toEqual(["agent"]);
    });
});

describe("A26–A31 · payload, session, snapshot, tag gộp, lệnh trong nội dung, nhãn step [H2b-R06 · P17]", () => {
  /** Flow 12 tin có sẵn; gửi '@assistant …' → độ dài `payload.history` của job agent. */
  async function historyLen(conv: string, flow: string): Promise<{ n: number; stream: unknown }> {
    const x = await startDirect("lan", "@assistant Tiếp A26", conv, flow);
    await rt.agent(x.job, { status: "done", text: "Xong A26." });
    await finish(x);
    return { n: x.job.payload.history.length, stream: (x.job.payload as Json).stream };
  }

  it("HUB-FR-91 · A26 · payload.history = history_n tin gần nhất theo Orchestrator đã chọn (mặc định 10; bản acme history_n=2 → 2); payload.stream = true [H2b-R06 · H2b-R19 · P10]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `H26-${i + 1}`,
    }));
    const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), { msgs });
    const first = await historyLen(conv, flow);
    expect(first).toEqual({ n: 10, stream: true });
    await tenantOrch(sql, T.acme, AG.orchestrator, { historyN: 2 });
    try {
      const got = await waitFor(
        () => historyLen(conv, flow),
        (h) => h.n === 2,
        5_000,
      );
      expect(got.n).toBe(2);
    } finally {
      await dropTenantOrch(sql, T.acme);
    }
  }, 30_000);

  it("HUB-FR-91 · A27 · cli_sessions(conv, assistant, fake-cli) có sẵn → job run direct use_session=true, cùng conversation_id/agent [H2b-R06 · H1-R23]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    await sql`insert into hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id, session_id)
      values (${conv}, ${AG.assistant}, 'fake-cli', ${T.acme}, 'qc-session-a27')`;
    const x = await startDirect("lan", "@assistant Tiếp phiên A27", conv);
    expect(x.job.payload).toMatchObject({
      use_session: true,
      conversation_id: conv,
      agent: { id: AG.assistant, key: "assistant" },
    });
    await rt.agent(x.job, { status: "done", text: "Tiếp phiên." });
    await finish(x);
  });

  it("HUB-BR-06 · A28 · job đang queued → tắt assistant → run vẫn chạy tới run.finished [H2b-R06 · HUB-BR-06]", async () => {
    const x = await start("lan", "@assistant Việc A28");
    const queued = await rt.peek(x.runId);
    expect(queued).toBeDefined();
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.agents set enabled = false where id = ${AG.assistant}`,
    );
    try {
      const job = await rt.next(x.runId);
      expect(job.payload.agent.key).toBe("assistant");
      await rt.agent(job, { status: "done", text: "Chạy theo snapshot A28." });
      expect((await finish(x))?.content).toBe("Chạy theo snapshot A28.");
    } finally {
      await hubConfigChange(
        sql,
        (tx) => tx`update hub.agents set enabled = true where id = ${AG.assistant}`,
      );
    }
  });

  it("HUB-FR-91 · A29 · '  @Assistant @assistant x' → direct (gộp, không phân biệt hoa thường), prompt = 'x' [H2b-R01 · H2b-R04]", async () => {
    const x = await startDirect("lan", "  @Assistant @assistant x");
    expect(x.job.payload.agent.key).toBe("assistant");
    expect(x.job.payload.prompt).toBe("x");
    expect((await runRow(sql, x.runId))?.kind).toBe("direct");
  });

  it("HUB-FR-91 · A30 · '@assistant /dich en xin' → direct, prompt chứa '/dich en xin', MK 0 lời gọi [P17]", async () => {
    dify.mock.reset();
    const x = await startDirect("lan", "@assistant /dich en xin");
    expect(x.job.payload.prompt).toContain("/dich en xin");
    await rt.agent(x.job, { status: "done", text: "Không chạy lệnh." });
    await finish(x);
    expect(dify.runs().length).toBe(0);
    expect((await runRow(sql, x.runId))?.kind).toBe("direct");
  });

  it("HUB-FR-91 · A31 · step delegate nhãn tĩnh (label_key step.delegate); SSE step.* không chứa 'assistant'/'Trợ lý' [H2b-R06]", async () => {
    const x = await startDirect("lan", "@assistant Việc A31");
    await rt.agent(x.job, { status: "done", text: "Xong việc." });
    await finish(x);
    const steps = await sql`select type, label_key from hub.run_steps where run_id = ${x.runId}`;
    expect([...steps]).toEqual([{ type: "delegate", label_key: "step.delegate" }]);
    const stepEvents = x.s.events.filter((e) => e.event.startsWith("step."));
    expect(stepEvents.length).toBeGreaterThan(0);
    for (const bad of ["assistant", ASSISTANT_NAME.vi])
      expect(JSON.stringify(stepEvents)).not.toContain(bad);
  });
});
