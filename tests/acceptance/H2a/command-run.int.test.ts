// HUB-FR-11, HUB-FR-12, HUB-FR-13 (sync), HUB-FR-80 · AC-H01 · HUB-H2a-AC-01, HUB-H2a-AC-02 · H2a-R06, R08, R09, R15, R16
// · test-plan H2a §5 A10–A19: E12 command sync gọi Dify (mock MK sau proxy `_h2a.ts`), inputs từ args/context, delta,
// usage `billing=dify`, run/step `command`/`workflow`, `CMD_MISSING_ARG`, snapshot khi sửa giữa chừng, `context` sai → 400.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CHAT_COMMAND_ERRORS,
  CmdMissingArgDetailsSchema,
  ErrorResponseSchema,
} from "@ai/contracts/chat";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  counts,
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
} from "../H1/_fixtures";
import {
  deltaText,
  type HubX,
  insertConv,
  insertHubConfig,
  openSse,
  runIdOf,
  type Sse,
  testRedis,
} from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import {
  CMD,
  catalogChange,
  type Dify,
  FEAT,
  idGen2,
  insertCatalog,
  setAppKey,
  startDify,
  startHubH2a,
  WF,
  WF_KEY,
  WF_NAME,
} from "./_h2a";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
let dify: Dify;
const id = idGen2(2000);
const MOCK_TEXT = "Xin chào, đây là mock.";

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2a(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

/** E12 trên hội thoại mới của `who` (kèm `context` tuỳ chọn). */
async function sendCmd(who: UserKey, content: string, context?: Json): Promise<Sse> {
  const conv = await insertConv(sql, who, id());
  const body = context === undefined ? { content } : { content, context };
  return openSse(hub, "POST", `/conversations/${conv}/messages`, {
    token: await sign(k, USERS[who]),
    body,
  });
}
/** Chạy tới sự kiện kết thúc rồi đóng; trả stream (đã có `events`). */
async function runToEnd(who: UserKey, content: string, context?: Json, ms = 8_000) {
  const s = await sendCmd(who, content, context);
  try {
    if (s.status === 200) await s.terminal(ms);
  } finally {
    s.close();
  }
  return s;
}
const missingArg = (s: Sse) => {
  expect(s.status).toBe(CHAT_COMMAND_ERRORS.CMD_MISSING_ARG);
  const e = ErrorResponseSchema.safeParse(s.json);
  expect(e.data?.error.code).toBe("CMD_MISSING_ARG");
  expect(e.data?.error.message).toBe("Missing or invalid command argument");
  return CmdMissingArgDetailsSchema.safeParse(e.data?.error.details).data;
};

describe("A10–A11 · inputs và lời gọi Dify sync [AC-H01 · HUB-FR-11 · HUB-FR-80]", () => {
  it("A10 · context.selection + '/dich en' → MK đúng 1 POST /v1/workflows/run (inputs, user acme:<lan>, streaming, Bearer mk-ok); ≥ 5 delta, run.finished.content = nối delta [AC-H01 · HUB-FR-80]", async () => {
    dify.mock.reset();
    const s = await runToEnd("lan", "/dich en", { selection: "xin chào" });
    expect(s.status).toBe(200);
    const runs = dify.runs();
    expect(runs.length).toBe(1);
    expect(runs[0]?.path).toBe("/v1/workflows/run");
    expect(runs[0]?.auth).toBe("Bearer mk-ok");
    const body = runs[0]?.body as Json;
    expect(body?.inputs).toEqual({ source_text: "xin chào", target_lang: "en", tone: "neutral" });
    expect(body).toMatchObject({ user: `acme:${USERS.lan.id}`, response_mode: "streaming" });
    const deltas = s.events.filter((e) => e.event === "delta");
    expect(deltas.length).toBeGreaterThanOrEqual(5);
    const end = s.events.find((e) => e.event === "run.finished");
    expect(end?.data?.content).toBe(deltaText(s.events));
    expect(end?.data?.content).toBe(MOCK_TEXT);
  });

  it("A11 · rest nguyên văn trim hai đầu; tham số trong ngoặc kép; tin thường kèm context → payload Orchestrator không chứa selection [HUB-FR-11 · H2a-R16]", async () => {
    dify.mock.reset();
    await runToEnd("lan", "/dich en  hello   world ");
    expect(dify.runs()[0]?.body).toMatchObject({
      inputs: { source_text: "hello   world", target_lang: "en" },
    });
    dify.mock.reset();
    await runToEnd("lan", '/dich "en" xin');
    expect(dify.runs()[0]?.body).toMatchObject({
      inputs: { source_text: "xin", target_lang: "en" },
    });
    const SEL = "MOI-SELECTION-A11-5c1e";
    const s = await sendCmd("lan", "Xin chào bạn", {
      selection: SEL,
      page_url: "https://vi.example/a11",
    });
    try {
      expect(s.status).toBe(200);
      const job = await rt.next(runIdOf(s));
      expect(JSON.stringify(job.payload)).not.toContain(SEL);
      expect(JSON.stringify(job.payload)).not.toContain("vi.example/a11");
      await rt.decide(job, echoAnswer(job));
      await s.terminal();
    } finally {
      s.close();
    }
  });
});

describe("A12–A13 · CMD_MISSING_ARG trước khi tạo run [HUB-FR-12]", () => {
  it("A12 · '/dich' không lang, không selection → 422 {missing:[lang,text], invalid:[]}; không message/run/job [HUB-FR-12]", async () => {
    const before = await counts(sql);
    dify.mock.reset();
    const s = await sendCmd("lan", "/dich");
    s.close();
    expect(missingArg(s)).toEqual({ missing: ["lang", "text"], invalid: [] });
    const after = await counts(sql);
    expect([after.messages, after.runs, after.jobs]).toEqual([
      before.messages,
      before.runs,
      before.jobs,
    ]);
    expect(dify.runs().length).toBe(0);
  });

  it("A13 · '/so abc maybe' → invalid [n, flag]; '/dich xx a' → invalid [lang]; '/hoi' → missing [q] [HUB-FR-12]", async () => {
    const a = await sendCmd("lan", "/so abc maybe");
    a.close();
    expect(missingArg(a)).toEqual({ missing: [], invalid: ["n", "flag"] });
    const b = await sendCmd("lan", "/dich xx a");
    b.close();
    expect(missingArg(b)).toEqual({ missing: [], invalid: ["lang"] });
    const c = await sendCmd("lan", "/hoi");
    c.close();
    expect(missingArg(c)).toEqual({ missing: ["q"], invalid: [] });
  });
});

describe("A14–A17 · kết quả, usage, run/step, app chat [HUB-H2a-AC-02 · H2a-R08 · H2a-R09 · H2a-R15]", () => {
  it("A14 · mk-outputs (không chunk) → delta lấy từ outputs[output.field='text']; run.finished.content đúng [HUB-H2a-AC-02]", async () => {
    await setAppKey(sql, "dich", "mk-outputs");
    try {
      const s = await runToEnd("lan", "/dich en xin");
      expect(s.status).toBe(200);
      expect(deltaText(s.events)).toBe(MOCK_TEXT);
      expect(s.events.find((e) => e.event === "run.finished")?.data?.content).toBe(MOCK_TEXT);
    } finally {
      await setAppKey(sql, "dich", "mk-ok");
    }
  });

  it("A15 · 1 dòng usage_logs: billing/provider dify, model NULL, input=total_tokens(20), output 0, cost_usd=total_price USD, latency>0, feature_id translate (lan) / aaa-dup (hoa, Q4) [HUB-H2a-AC-02 · H2a-R15]", async () => {
    for (const [who, feature] of [
      ["lan", FEAT.translate],
      ["hoa", FEAT.aaaDup],
    ] as const) {
      const s = await runToEnd(who, "/dich en xin");
      expect(s.status).toBe(200);
      const rows = await sql<
        Json[]
      >`select billing, provider_key, model, input_tokens, output_tokens,
          cost_usd::float8 as cost, latency_ms, feature_id, agent_id, user_id, tenant_id
        from hub.usage_logs where run_id = ${runIdOf(s)}`;
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        billing: "dify",
        provider_key: "dify",
        model: null,
        input_tokens: 20,
        output_tokens: 0,
        cost: 0.0001,
        feature_id: feature,
        agent_id: null,
        user_id: USERS[who].id,
        tenant_id: USERS[who].tid,
      });
      expect(rows[0]?.latency_ms).toBeGreaterThan(0);
    }
  });

  it("A16 · runs.kind='command' + command_id + feature_id; 1 run_step type='workflow' workflow_id; nhãn 'Đang chạy lệnh' (vi) / 'Running command' (en); SSE step.* không tên/key workflow [H2a-R08 · H2a-R09]", async () => {
    for (const [who, label] of [
      ["lan", "Đang chạy lệnh"],
      ["hoa", "Running command"],
    ] as const) {
      const s = await runToEnd(who, "/dich en xin");
      expect(s.status).toBe(200);
      const runId = runIdOf(s);
      const [run] = await sql<
        Json[]
      >`select kind, command_id, feature_id from hub.runs where id = ${runId}`;
      expect(run).toEqual({
        kind: "command",
        command_id: CMD.dich,
        feature_id: who === "lan" ? FEAT.translate : FEAT.aaaDup,
      });
      const steps = await sql<Json[]>`select type, workflow_id, status from hub.run_steps
        where run_id = ${runId} order by seq`;
      expect([...steps]).toEqual([{ type: "workflow", workflow_id: WF.dich, status: "ok" }]);
      const stepEvs = s.events.filter((e) => e.event.startsWith("step."));
      expect(stepEvs.find((e) => e.event === "step.started")?.data?.label).toBe(label);
      const raw = JSON.stringify(stepEvs);
      expect(raw).not.toContain(WF_NAME("dich"));
      expect(raw).not.toContain(`"${WF_KEY.dich}"`);
      expect(raw).not.toContain("node");
    }
  });

  it("A17 · /hoi (app chat, mk-agent) → POST /v1/chat-messages có query; agent_message.answer → delta ≤ 40 ký tự; nội dung = nối chunk [H2a-R09]", async () => {
    dify.mock.reset();
    const s = await runToEnd("lan", "/hoi giá vàng hôm nay");
    expect(s.status).toBe(200);
    const runs = dify.runs();
    expect(runs.length).toBe(1);
    expect(runs[0]?.path).toBe("/v1/chat-messages");
    expect(runs[0]?.body).toMatchObject({
      query: "giá vàng hôm nay",
      response_mode: "streaming",
      user: `acme:${USERS.lan.id}`,
    });
    const deltas = s.events.filter((e) => e.event === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    for (const d of deltas) expect(String(d.data?.text).length).toBeLessThanOrEqual(40);
    expect(s.events.find((e) => e.event === "run.finished")?.data?.content).toBe(MOCK_TEXT);
  });
});

describe("A18–A19 · snapshot giữa chừng, context sai [HUB-BR-06 · H2a-R16]", () => {
  it("A18 · run /dich (mk-slow-300) → giữa chừng đổi input_map, mô tả workflow, tắt workflow → run hiện tại xong với inputs cũ [HUB-BR-06 · H2a-R08]", async () => {
    await setAppKey(sql, "dich", "mk-slow-300");
    dify.mock.reset();
    const s = await sendCmd("lan", "/dich en xin");
    try {
      expect(s.status).toBe(200);
      expect(await s.until((e) => e.event === "delta", 5_000)).toBeDefined();
      await catalogChange(sql, async (tx) => {
        await tx`update admin.commands set input_map = jsonb_set(input_map, '{tone,value}', '"formal"')
          where id = ${CMD.dich}`;
        await tx`update admin.workflows set enabled = false,
          description = 'Mô tả mới đổi giữa chừng khi run đang chạy.' where id = ${WF.dich}`;
      });
      const end = await s.terminal(10_000);
      expect(end?.event).toBe("run.finished");
      expect(end?.data?.content).toBe(MOCK_TEXT);
      expect(dify.runs().length).toBe(1);
      expect(dify.runs()[0]?.body).toMatchObject({ inputs: { tone: "neutral" } });
    } finally {
      s.close();
      await setAppKey(sql, "dich", "mk-ok");
      await catalogChange(sql, async (tx) => {
        await tx`update admin.commands set input_map = jsonb_set(input_map, '{tone,value}', '"neutral"')
          where id = ${CMD.dich}`;
        await tx`update admin.workflows set enabled = true,
          description = ${`Workflow thử ${WF_KEY.dich} dùng trong kiểm thử H2a.`} where id = ${WF.dich}`;
      });
    }
  });

  it("A19 · context sai (page_url ftp:, selection 16 001 ký tự, khoá thừa) → 400 VALIDATION_ERROR, không ghi gì [H2a-R16]", async () => {
    const before = await counts(sql);
    for (const context of [
      { page_url: "ftp://x.example/a" },
      { selection: "a".repeat(16_001) },
      { selection: "x", extra: 1 },
    ]) {
      const s = await sendCmd("lan", "/dich en", context);
      s.close();
      expect(s.status).toBe(400);
      expect(ErrorResponseSchema.safeParse(s.json).data?.error.code).toBe("VALIDATION_ERROR");
    }
    const after = await counts(sql);
    expect([after.messages, after.runs]).toEqual([before.messages, before.runs]);
  });
});
