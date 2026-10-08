// HUB-FR-20, 21, 27, 29, 03 · HUB-BR-04, BR-06 · HUB-H1-AC-H09, H14, H15, AC-10, AC-12 · test-plan H1 §5 A14, A16–A25,
// test-plan-cases §1 A56a/b, A57, P45b(A): vòng Orchestrator nhìn từ payload job (Runtime kịch bản) + SSE + DB.
// A26 (job.failed → run.failed) gộp với A56a. Hộp đen: HTTP hub-api thật + DB `ai_system_h1_test` + Redis DB 15.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type { HubJobErrorCode } from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { runErrorText } from "../../../apps/hub-api/src/modules/runs/run-errors";
import { stripStepAgent } from "../CR-054/_step-agent";
import {
  call,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
  waitFor,
} from "./_fixtures";
import {
  AG,
  AGENT_DESC,
  block,
  deltaText,
  type HubX,
  hubConfigChange,
  idGen,
  insertConv,
  insertFlow,
  insertHubConfig,
  ORCH_PROMPT,
  runIdOf,
  type Sse,
  send,
  startHubX,
  testRedis,
} from "./_hub";
import { echoAnswer, type Job, ScriptRuntime } from "./_runtime";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
const id = idGen(2000);

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
type Started = { s: Sse; runId: string; conv: string; flowId: string };

/** E12 (hội thoại mới nếu không truyền `conv`); 200 bắt buộc. */
async function start(
  who: UserKey,
  content: string,
  conv?: string,
  flow?: string,
  h: HubX = hub,
): Promise<Started> {
  const c = conv ?? (await insertConv(sql, who, id()));
  const s = await send(h, await tok(who), c, content, flow);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv: c, flowId: s.headers.get("x-flow-id") ?? "" };
}
async function finish(x: Started, event = "run.finished"): Promise<Json> {
  const end = await x.s.terminal(15_000);
  x.s.close();
  expect(end?.event).toBe(event);
  return end?.data;
}
async function answer(job: Job, text = "Xong rồi."): Promise<void> {
  await rt.decide(job, { decision: "answer", text });
}
const agentsOf = (job: Job): Json => JSON.parse(block(job.payload.prompt, "agents") ?? "null");
const agentKeys = (job: Job): string[] => (agentsOf(job) ?? []).map((a: Json) => a.key);
async function messagesOf(conv: string, flowId: string, who: UserKey = "lan"): Promise<Json[]> {
  const res = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${flowId}`, {
    token: await tok(who),
  });
  expect(res.status).toBe(200);
  return res.json?.items ?? [];
}
const jobCount = async (runId: string): Promise<number> => {
  const [r] = await sql<
    { n: number }[]
  >`select count(*)::int as n from hub.jobs where run_id = ${runId}`;
  return r?.n ?? 0;
};

describe("A14, A16–A19 · payload job và đường đi quyết định [HUB-FR-20 · HUB-FR-27 · HUB-FR-29]", () => {
  it("A14 · payload Orchestrator: output=text, use_session=false, allowed_tools=[], max_turns=3; <agents> = R7 (không orchestrator, không hoadon); khối định dạng cuối system_prompt [HUB-FR-20 · HUB-H1-AC-H09]", async () => {
    const x = await start("lan", "Xin chào A14");
    const job = await rt.next(x.runId);
    const p = job.payload;
    expect(p).toMatchObject({
      type: "agent.cli",
      runtime: "agentic-cli",
      run_id: x.runId,
      tenant_id: T.acme,
      user_id: USERS.lan.id,
      conversation_id: x.conv,
      flow_id: x.flowId,
      agent: { id: AG.orchestrator, key: "orchestrator", role: "orchestrator" },
      provider_key: "fake-cli",
      step_index: 0,
      output: "text",
      use_session: false,
      allowed_tools: [],
      max_turns: 3,
    });
    expect(p.profile_steps).toEqual([{ provider_key: "fake-cli", model: null, on: [] }]);
    expect(agentsOf(job)).toEqual([
      { key: "assistant", description: AGENT_DESC.assistant },
      { key: "helper", description: AGENT_DESC.helper },
    ]);
    expect(p.system_prompt.startsWith(ORCH_PROMPT)).toBe(true);
    const tail = p.system_prompt.slice(ORCH_PROMPT.length);
    expect(tail).toContain("Chỉ trả về MỘT object JSON theo JSON Schema sau");
    expect(tail).toContain('"decision"');
    expect(tail.trimEnd().endsWith("agent đó.")).toBe(true);
    for (const tag of ["agents", "flow_hint", "history", "steps", "steps_left", "message"])
      expect(block(p.prompt, tag)).not.toBeNull();
    await answer(job);
    await finish(x);
  });

  it("A16 · delegate → done: stream thẳng kết quả agent, không job Orchestrator thứ 2; flows.agent_id = agent [HUB-FR-29]", async () => {
    const x = await start("lan", "Nhờ trợ lý A16");
    await rt.decide(await rt.next(x.runId), {
      decision: "delegate",
      agent: "assistant",
      task: "Việc A16",
    });
    const ag = await rt.next(x.runId);
    expect(ag.payload.agent).toEqual({ id: AG.assistant, key: "assistant", role: "agent" });
    expect(ag.payload.prompt).toBe("Việc A16");
    const text = "Kết quả của trợ lý cho ca A16, trả thẳng không qua Orchestrator.";
    await rt.agent(ag, { status: "done", text });
    const end = await finish(x);
    expect(deltaText(x.s.events)).toBe(text);
    expect(end?.content).toBe(text);
    expect(await jobCount(x.runId)).toBe(2);
    const [f] = await sql`select agent_id from hub.flows where id = ${x.flowId}`;
    expect(f?.agent_id).toBe(AG.assistant);
  });

  it("A17 · partial → job Orchestrator kế có <steps> chứa missing; answer cuối là nội dung run [HUB-FR-27]", async () => {
    const x = await start("lan", "Làm báo cáo A17");
    await rt.decide(await rt.next(x.runId), {
      decision: "delegate",
      agent: "assistant",
      task: "Báo cáo",
    });
    await rt.agent(await rt.next(x.runId), {
      status: "partial",
      text: "Đã có số liệu.",
      missing: "THIEU-BIEU-DO-A17",
    });
    const orch2 = await rt.next(x.runId);
    expect(orch2.payload.agent.role).toBe("orchestrator");
    expect(block(orch2.payload.prompt, "steps") ?? "").toContain("THIEU-BIEU-DO-A17");
    await answer(orch2, "Báo cáo hoàn chỉnh A17.");
    expect((await finish(x))?.content).toBe("Báo cáo hoàn chỉnh A17.");
  });

  it("A18 · need_input → ask (không key agent/provider), run finished, E11 có ask, pending_ask; tin kế: waiting_for = agent → delegate → job use_session=true [HUB-H1-AC-H15]", async () => {
    const x = await start("lan", "Đặt lịch họp A18");
    await rt.decide(await rt.next(x.runId), {
      decision: "delegate",
      agent: "assistant",
      task: "Đặt lịch",
    });
    const ask = { question: "Họp lúc mấy giờ?", choices: ["9:00", "14:00"] };
    await rt.agent(await rt.next(x.runId), { status: "need_input", ...ask });
    await finish(x);
    expect(x.s.events.find((e) => e.event === "ask")?.data).toEqual(ask);
    for (const e of stripStepAgent(x.s.events)) {
      expect(Object.keys(e.data ?? {})).not.toContain("agent");
      expect(Object.keys(e.data ?? {})).not.toContain("provider");
    }
    expect(JSON.stringify(stripStepAgent(x.s.events))).not.toContain("assistant");
    const msgs = await messagesOf(x.conv, x.flowId);
    expect(msgs.find((m) => m.role === "assistant")?.ask).toEqual(ask);
    const [f] = await sql`select agent_id, pending_ask from hub.flows where id = ${x.flowId}`;
    expect(f).toMatchObject({ agent_id: AG.assistant, pending_ask: true });

    const y = await start("lan", "14:00", x.conv, x.flowId);
    const orch = await rt.next(y.runId);
    expect(JSON.parse(block(orch.payload.prompt, "flow_hint") ?? "null")).toMatchObject({
      waiting_for: "assistant",
    });
    await rt.decide(orch, { decision: "delegate", agent: "assistant", task: "14:00" });
    const ag = await rt.next(y.runId);
    expect(ag.payload.use_session).toBe(true);
    await rt.agent(ag, { status: "done", text: "Đã đặt lịch 14:00." });
    await finish(y);
    const [g] = await sql`select pending_ask from hub.flows where id = ${x.flowId}`;
    expect(g?.pending_ask).toBe(false);
  });

  it("A19 · flow gắn assistant, tin 2 → delegate helper → flows.agent_id = helper, run_steps ghi bước delegate [HUB-H1-AC-H14]", async () => {
    const conv = await insertConv(sql, "lan", id());
    const flow = await insertFlow(sql, "lan", conv, id(), {
      agentId: AG.assistant,
      msgs: [
        { role: "user", content: "Câu đầu" },
        { role: "assistant", content: "Trả lời đầu" },
      ],
    });
    const x = await start("lan", "Soạn văn bản A19", conv, flow);
    const orch = await rt.next(x.runId);
    expect(JSON.parse(block(orch.payload.prompt, "flow_hint") ?? "null")).toMatchObject({
      last_agent: "assistant",
    });
    await rt.decide(orch, { decision: "delegate", agent: "helper", task: "Soạn" });
    const ag = await rt.next(x.runId);
    expect(ag.payload.agent.key).toBe("helper");
    await rt.agent(ag, { status: "done", text: "Văn bản đã soạn." });
    await finish(x);
    const [f] = await sql`select agent_id from hub.flows where id = ${flow}`;
    expect(f?.agent_id).toBe(AG.helper);
    const steps =
      await sql`select type, agent_id, job_id from hub.run_steps where run_id = ${x.runId} order by seq`;
    expect(steps.map((s) => [s.type, s.agent_id, s.job_id])).toEqual([
      ["orchestrator", AG.orchestrator, orch.id],
      ["delegate", AG.helper, ag.id],
    ]);
  });
});

describe("A20–A24 · JSON hỏng, ngoài danh sách, ngân sách, history [AC-10 · AC-12 · HUB-FR-21]", () => {
  const REMIND = "Lần trước không phải JSON hợp lệ theo schema. Chỉ trả JSON.";

  it("A20 · JSON hỏng 1 lần → gọi lại cùng step kèm câu nhắc; hỏng 2 lần → UPSTREAM_ERROR, vẫn có tin assistant [HUB-H1-AC-10]", async () => {
    const x = await start("lan", "Câu A20a");
    const o1 = await rt.next(x.runId);
    await rt.text(o1, "đây không phải JSON");
    const o2 = await rt.next(x.runId);
    expect(o2.payload.step_id).toBe(o1.payload.step_id);
    expect(`${o2.payload.system_prompt}\n${o2.payload.prompt}`).toContain(REMIND);
    await answer(o2, "Đã sửa.");
    await finish(x);

    const y = await start("lan", "Câu A20b");
    await rt.text(await rt.next(y.runId), "hỏng lần 1");
    await rt.text(await rt.next(y.runId), '```json\n{"decision": "khong-hop-le"}\n```');
    const fail = await finish(y, "run.failed");
    expect(fail?.code).toBe("UPSTREAM_ERROR");
    const msgs = await messagesOf(y.conv, y.flowId);
    expect(msgs.find((m) => m.role === "assistant")?.run?.error?.code).toBe("UPSTREAM_ERROR");
  });

  it("A21 · delegate ngoài danh sách (hoadon) → step skipped not_allowed, không job, tính vào max_steps [HUB-H1-AC-10]", async () => {
    const x = await start("lan", "Tra hoá đơn A21");
    const o1 = await rt.next(x.runId);
    await rt.decide(o1, { decision: "delegate", agent: "hoadon", task: "Tra" });
    const o2 = await rt.next(x.runId);
    expect(o2.payload.agent.role).toBe("orchestrator");
    const left = (j: Job) => Number(/\d+/.exec(block(j.payload.prompt, "steps_left") ?? "")?.[0]);
    expect(left(o2)).toBeLessThan(left(o1) - 1);
    await answer(o2, "Không có agent hoá đơn.");
    await finish(x);
    const [j] = await sql<
      { n: number }[]
    >`select count(*)::int as n from hub.jobs where agent_id = ${AG.hoadon}`;
    expect(j?.n).toBe(0);
    const skipped =
      await sql`select detail from hub.run_steps where run_id = ${x.runId} and status = 'skipped'`;
    expect(skipped.map((s) => s.detail?.reason)).toEqual(["not_allowed"]);
  });

  it("A22 · agent luôn partial → hết max_steps → run.finished kèm câu báo; luôn delegate không phép → BUDGET_EXCEEDED [HUB-H1-AC-10 · H1-R07]", async () => {
    const x = await start("lan", "Việc dài A22a");
    const n = await rt.serve(x.runId, async (job) => {
      if (job.payload.agent.role === "orchestrator")
        await rt.decide(job, { decision: "delegate", agent: "assistant", task: "Tiếp" });
      else await rt.agent(job, { status: "partial", text: "PHAN-DA-LAM-A22", missing: "còn nữa" });
    });
    expect(n).toBeLessThanOrEqual(5);
    expect((await finish(x))?.content).toContain("PHAN-DA-LAM-A22");

    const y = await start("lan", "Việc A22b");
    await rt.serve(y.runId, (job) =>
      rt.decide(job, { decision: "delegate", agent: "hoadon", task: "Tra" }),
    );
    expect((await finish(y, "run.failed"))?.code).toBe("BUDGET_EXCEEDED");
  }, 60_000);

  it("A23 · usage vượt token_budget (200 000) → dừng theo R07, không gọi Orchestrator nữa [HUB-FR-21]", async () => {
    const x = await start("lan", "Việc tốn token A23");
    await rt.decide(
      await rt.next(x.runId),
      { decision: "delegate", agent: "assistant", task: "Làm" },
      { input_tokens: 150_000, output_tokens: 60_000 },
    );
    await rt.agent(await rt.next(x.runId), {
      status: "partial",
      text: "KET-QUA-DO-DANG-A23",
      missing: "phần cuối",
    });
    expect((await finish(x))?.content).toContain("KET-QUA-DO-DANG-A23");
    expect(await jobCount(x.runId)).toBe(2);
  });

  it("A24 · <history> chỉ tin flow hiện tại, ≤ history_n (10), không gồm tin hiện tại, mỗi tin ≤ 4000 ký tự [HUB-H1-AC-12]", async () => {
    const conv = await insertConv(sql, "lan", id());
    await insertFlow(sql, "lan", conv, id(), {
      msgs: [{ role: "user", content: "KHAC-FLOW-A24" }],
    });
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `H-${String(i + 1).padStart(2, "0")}${i === 10 ? ` ${"x".repeat(5000)}` : ""}`,
    }));
    const flow = await insertFlow(sql, "lan", conv, id(), { msgs });
    const x = await start("lan", "TIN-HIEN-TAI-A24", conv, flow);
    const job = await rt.next(x.runId);
    const hist = block(job.payload.prompt, "history") ?? "";
    for (const n of ["03", "04", "10", "11", "12"]) expect(hist).toContain(`H-${n}`);
    for (const n of ["01", "02"]) expect(hist).not.toContain(`H-${n}`);
    expect(hist).not.toContain("KHAC-FLOW-A24");
    expect(hist).not.toContain("TIN-HIEN-TAI-A24");
    expect(hist).toContain("x".repeat(100));
    expect(hist).not.toContain("x".repeat(4001));
    expect(block(job.payload.prompt, "message") ?? "").toContain("TIN-HIEN-TAI-A24");
    await answer(job);
    await finish(x);
  });
});

describe("A26, A56 · job lỗi → run.failed, câu lỗi theo locale [HUB-BR-04]", () => {
  const LEAK = "claude-sub-1 assistant /home/worker/work/job-x/x stacktrace";
  const FORBIDDEN = ["claude-sub", "assistant", "/home/", "work/", "stacktrace"];

  async function failedRun(who: UserKey, code: HubJobErrorCode, message = LEAK) {
    const x = await start(who, `Việc lỗi ${code}`);
    await rt.decide(await rt.next(x.runId), {
      decision: "delegate",
      agent: "assistant",
      task: "Làm",
    });
    await rt.fail(
      await rt.next(x.runId),
      code,
      message,
      code === "ALL_PROVIDERS_EXHAUSTED" ? "quota" : null,
    );
    return { x, data: await finish(x, "run.failed") };
  }

  for (const code of [
    "TIMEOUT",
    "UPSTREAM_ERROR",
    "INTERNAL_ERROR",
    "ALL_PROVIDERS_EXHAUSTED",
  ] as const) {
    it(`A26 · A56a · job.failed ${code} → run.failed cùng mã, message không rỗng, không lộ provider/agent/đường dẫn; gốc ở run_steps.detail; SSE = GET /runs/:id [HUB-BR-04 · HUB-H1-AC-10]`, async () => {
      const { x, data } = await failedRun("lan", code);
      expect(data?.code).toBe(code);
      expect(String(data?.message).length).toBeGreaterThan(0);
      const e11 = (await messagesOf(x.conv, x.flowId)).find((m) => m.role === "assistant");
      for (const bad of FORBIDDEN) {
        expect(JSON.stringify(data)).not.toContain(bad);
        expect(JSON.stringify(e11?.run?.error)).not.toContain(bad);
      }
      const details = await sql`select detail from hub.run_steps where run_id = ${x.runId}`;
      expect(JSON.stringify(details.map((d) => d.detail))).toContain("stacktrace");
      const run = await call(hub, "GET", `/runs/${x.runId}`, { token: await tok("lan") });
      expect(run.status).toBe(200);
      expect(run.json?.error).toEqual({ code, message: data?.message, hint: data?.hint });
    });
  }

  it("A56b · cùng mã ở lan (vi) và hoa (en) → message/hint nguyên văn bảng lỗi theo locale; 2 run khác nội dung gốc → giống nhau; hint luôn string [HUB-BR-04 · C1-R04]", async () => {
    const code: ChatRunErrorCode = "UPSTREAM_ERROR";
    const vi1 = await failedRun("lan", code, "lỗi gốc thứ nhất");
    const vi2 = await failedRun("lan", code, "một lỗi gốc hoàn toàn khác");
    const en = await failedRun("hoa", code, "original failure");
    const pick = (d: Json) => ({ message: d?.message, hint: d?.hint });
    expect(pick(vi1.data)).toEqual(runErrorText(code, "vi"));
    expect(pick(vi2.data)).toEqual(pick(vi1.data));
    expect(pick(en.data)).toEqual(runErrorText(code, "en"));
    expect(en.data?.message).not.toBe(vi1.data?.message);
    expect(en.data?.hint).not.toBe(vi1.data?.hint);
    for (const d of [vi1.data, en.data]) expect(typeof d?.hint).toBe("string");
    const [r] =
      await sql`select locale, error_message, error_hint from hub.runs where id = ${en.x.runId}`;
    const t = runErrorText(code, "en");
    expect(r).toEqual({ locale: "en", error_message: t.message, error_hint: t.hint });
  });
});

describe("P45b(A) · nội dung Orchestrator giả [K-R1 · H1-R09]", () => {
  it("P45b · Orchestrator echo <message> + câu cố định ≥ 120 ký tự → ≥ 3 delta; E11 content không chứa <agents>/<history> [WRK-FR-03 · H1-R09]", async () => {
    const x = await start("lan", "Xin chào P45");
    const job = await rt.next(x.runId);
    const d = echoAnswer(job);
    await rt.decide(job, d);
    const end = await finish(x);
    expect(String(end?.content).startsWith("echo: Xin chào P45")).toBe(true);
    expect([...String(end?.content)].length).toBeGreaterThanOrEqual(120);
    expect(x.s.events.filter((e) => e.event === "delta").length).toBeGreaterThanOrEqual(3);
    const msg = (await messagesOf(x.conv, x.flowId)).find((m) => m.role === "assistant");
    expect(msg?.content).toBe(end?.content);
    for (const bad of ["<agents>", "<history>", "<flow_hint>"])
      expect(msg?.content).not.toContain(bad);
  });
});

describe("A25, A57 · snapshot cấu hình và nạp lại [HUB-BR-06 · HUB-FR-03]", () => {
  /** Chạy run mới tới khi `<agents>` thoả `ok` hoặc hết `ms`; mỗi lần thử đều kết thúc run. */
  async function agentsWithin(
    ms: number,
    ok: (keys: string[]) => boolean,
    h: HubX = hub,
  ): Promise<string[]> {
    return waitFor(
      async () => {
        const x = await start("lan", "Kiểm cấu hình", undefined, undefined, h);
        const job = await rt.next(x.runId);
        const keys = agentKeys(job);
        await answer(job);
        await finish(x);
        return keys;
      },
      ok,
      ms,
    );
  }

  it("A25 · tắt assistant giữa run → run đang chạy giữ snapshot; run mới ≤ 5 s không thấy; cấp hoadon cho acme → ≤ 5 s thấy [HUB-BR-06 · HUB-H1-AC-H09]", async () => {
    const x = await start("lan", "Run giữ snapshot A25");
    const o1 = await rt.next(x.runId);
    expect(agentKeys(o1)).toContain("assistant");
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.agents set enabled = false where id = ${AG.assistant}`,
    );
    await rt.decide(o1, { decision: "delegate", agent: "assistant", task: "Vẫn chạy" });
    const ag = await rt.next(x.runId);
    expect(ag.payload.agent.key).toBe("assistant");
    await rt.agent(ag, { status: "done", text: "Chạy theo snapshot." });
    await finish(x);
    expect(await agentsWithin(5_000, (ks) => !ks.includes("assistant"))).not.toContain("assistant");

    await hubConfigChange(
      sql,
      (tx) =>
        tx`insert into hub.agent_entitlements (agent_id, tenant_id) values (${AG.hoadon}, ${T.acme})`,
    );
    expect(await agentsWithin(5_000, (ks) => ks.includes("hoadon"))).toContain("hoadon");
    await hubConfigChange(sql, async (tx) => {
      await tx`update hub.agents set enabled = true where id = ${AG.assistant}`;
      await tx`delete from hub.agent_entitlements where agent_id = ${AG.hoadon} and tenant_id = ${T.acme}`;
    });
  }, 60_000);

  it("A57 · HUB_CONFIG_POLL_S=1: đổi agents.enabled bằng SQL không NOTIFY → run mới ≤ 3 s thấy thay đổi [HUB-FR-03]", async () => {
    const h2 = await startHubX(k, { instanceId: "qc-hub-poll", configPollS: 1 });
    try {
      expect(await agentsWithin(3_000, (ks) => ks.includes("helper"), h2)).toContain("helper");
      await hubConfigChange(
        sql,
        (tx) => tx`update hub.agents set enabled = false where id = ${AG.helper}`,
        false,
      );
      expect(await agentsWithin(3_000, (ks) => !ks.includes("helper"), h2)).not.toContain("helper");
    } finally {
      await hubConfigChange(
        sql,
        (tx) => tx`update hub.agents set enabled = true where id = ${AG.helper}`,
      );
      await h2.stop();
    }
  });
});
