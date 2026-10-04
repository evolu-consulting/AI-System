// HUB-FR-50 · WRK-FR-13 · HUB-H2a-AC-05 · AC-H12 · HUB-BR-11, BR-12, BR-19 · H2a-R18–R20 · P4, P7, P11, P12 · spike S1
// · test-plan H2a §5 A50–A58: `/mcp` của Hub — auth bằng token job (chỉ hash, job `agent.cli` `running`), JSON-RPC
// (`initialize` 2025-11-25, `server/discover` chế độ 2026-07-28: `resultType:"complete"`, `tools/list` `ttlMs` +
// `cacheScope:"private"`, `id` chuỗi), `tools/list` theo agent ∩ enabled ∩ payload, `tools/call` gọi Dify gom, bước `tool`
// che secret rồi cắt, lỗi câu tĩnh, cô lập tenant, timeout tool. Job dựng bằng SQL owner (Q-T8, `_runtime2.ts`).
// Lệch plan (ghi §10): `agents_timeout_s_check` (10–3600) ⇒ A58 dùng `timeout_s=10` + `mk-slow-3000` thay cho 1.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MCP_PROTOCOL_VERSIONS } from "@ai/contracts/hub-internal";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  USERS,
  waitFor,
} from "../H1/_fixtures";
import { AG, type HubX, hubConfigChange, insertHubConfig, testRedis } from "../H1/_hub";
import {
  AG2,
  catalogChange,
  type Dify,
  idGen2,
  insertCatalog,
  insertH2aAgents,
  LEAK_INVOICE,
  leakForms,
  setAppKey,
  startDify,
  startHubH2a,
  WF,
  WF_KEY,
} from "./_h2a";
import { confirmations, MCP_ERR, MOCK_TEXT, rpcRaw, toolCall } from "./_h2a2";
import { insertSqlJob, newJobToken, type SqlJobOpts } from "./_runtime2";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let dify: Dify;
const id = idGen2(7000);
const DESC = "Kiểm tra một hoá đơn điện tử theo mã hoá đơn và trả kết quả đối chiếu.";

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  await insertH2aAgents(sql);
  k = await makeKeys();
  hub = await startHubH2a(k);
  redis = await testRedis();
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

const hoadon = (o: Partial<SqlJobOpts> = {}) =>
  insertSqlJob(sql, id, {
    type: "agent.cli",
    agentId: AG.hoadon,
    agentKey: "hoadon",
    tools: [WF_KEY.checkInvoice],
    mcpUrl: `${hub.base}/mcp`,
    ...o,
  });
const trello = (o: Partial<SqlJobOpts> = {}) =>
  insertSqlJob(sql, id, {
    type: "agent.cli",
    agentId: AG2.trello,
    agentKey: "trello",
    tools: [WF_KEY.trello],
    mcpUrl: `${hub.base}/mcp`,
    ...o,
  });
const rpc = (token: string, method: string, params?: unknown, rid: unknown = `r-${method}`) =>
  rpcRaw(hub, token, {
    jsonrpc: "2.0",
    id: rid,
    method,
    ...(params === undefined ? {} : { params }),
  });
const toolSteps = async (runId: string): Promise<Json[]> => [
  ...(await sql`select type, status, workflow_id, detail from hub.run_steps
    where run_id = ${runId} and type = 'tool' order by seq`),
];

describe("A50–A51 · auth /mcp [HUB-H2a-AC-05 · WRK-FR-13]", () => {
  it("WRK-FR-13 · A50 · không header / Bearer sai / token đúng hình không có hash → 401 body rỗng + WWW-Authenticate: Bearer; GET/DELETE → 405 [HUB-H2a-AC-05]", async () => {
    const j = await hoadon();
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const got = [
      await rpcRaw(hub, null, body),
      await rpcRaw(hub, null, body, { authorization: "Basic abc" }),
      await rpcRaw(hub, "khong-phai-token", body),
      await rpcRaw(hub, newJobToken(), body),
    ];
    for (const r of got) {
      expect({ status: r.status, text: r.text }).toEqual({ status: 401, text: "" });
      expect(r.headers.get("www-authenticate") ?? "").toMatch(/^Bearer/);
    }
    for (const m of ["GET", "DELETE"])
      expect((await rpcRaw(hub, j.token, undefined, {}, m)).status).toBe(405);
    expect((await rpc(j.token, "ping")).status).toBe(200);
  });

  it("WRK-FR-13 · A51 · token của job succeeded/cancelled/queued → 401; token job workflow.async (running) → 401 [HUB-H2a-AC-05 · WRK-FR-13]", async () => {
    const live = await hoadon();
    expect((await rpc(live.token, "tools/list")).status).toBe(200);
    for (const status of ["succeeded", "cancelled", "queued"] as const) {
      const j = await hoadon({ status });
      const r = await rpc(j.token, "tools/list");
      expect({ status, code: r.status, text: r.text }).toEqual({ status, code: 401, text: "" });
    }
    const w = await insertSqlJob(sql, id, {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
    });
    expect((await rpc(w.token, "tools/list")).status).toBe(401);
    // job vừa kết thúc → token hết hạn ngay
    await sql`update hub.jobs set status = 'succeeded', finished_at = now() where id = ${live.jobId}`;
    expect((await rpc(live.token, "tools/list")).status).toBe(401);
  });
});

describe("A52–A54 · JSON-RPC + tools/list [HUB-FR-50 · HUB-BR-11 · AC-H12]", () => {
  it("HUB-FR-50 · A52 · initialize giữ 2025-11-25/2025-06-18, lạ → 2026-07-28; server/discover supportedVersions; id chuỗi trả nguyên; resultType complete; tools/list ttlMs + cacheScope private; [check-invoice] mô tả + inputSchema [HUB-FR-50 · HUB-BR-11]", async () => {
    const j = await hoadon();
    for (const [sent, want] of [
      ["2025-11-25", "2025-11-25"],
      ["2025-06-18", "2025-06-18"],
      ["1999-01-01", "2026-07-28"],
    ]) {
      const r = await rpc(j.token, "initialize", {
        protocolVersion: sent,
        capabilities: {},
        clientInfo: { name: "claude-code", version: "2.1.286" },
      });
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type") ?? "").toContain("application/json");
      expect(r.headers.get("mcp-session-id")).toBeNull();
      expect(r.json?.result).toMatchObject({
        protocolVersion: want,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ai-hub", version: "1" },
        resultType: "complete",
      });
    }
    const disc = await rpcRaw(
      hub,
      j.token,
      {
        jsonrpc: "2.0",
        id: "server-discover-probe-1",
        method: "server/discover",
        params: { _meta: { protocolVersion: "2026-07-28" } },
      },
      { "mcp-method": "server/discover", "mcp-protocol-version": "2026-07-28" },
    );
    expect(disc.json?.id).toBe("server-discover-probe-1");
    expect(disc.json?.result?.supportedVersions).toEqual([...MCP_PROTOCOL_VERSIONS]);
    expect(disc.json?.result?.resultType).toBe("complete");
    const list = await rpc(j.token, "tools/list", {}, "list-1");
    expect(list.json?.id).toBe("list-1");
    const res = list.json?.result;
    expect(res?.resultType).toBe("complete");
    expect(typeof res?.ttlMs).toBe("number");
    expect(res?.cacheScope).toBe("private");
    expect(res?.tools?.map((t: Json) => t.name)).toEqual([WF_KEY.checkInvoice]);
    const t = res?.tools?.[0];
    expect(t?.description).toBe(DESC);
    expect(t?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        x: { type: "string", description: "Mã hoá đơn" },
        y: { type: "string", description: "Ghi chú" },
      },
    });
    const ping = await rpc(j.token, "ping", undefined, 7);
    expect(ping.json).toMatchObject({ jsonrpc: "2.0", id: 7 });
    expect(ping.json?.result?.resultType).toBe("complete");
    const note = await rpcRaw(hub, j.token, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect({ status: note.status, text: note.text }).toEqual({ status: 202, text: "" });
    expect((await rpc(j.token, "khong/co")).json?.error?.code).toBe(-32601);
    expect(
      (await rpcRaw(hub, j.token, [{ jsonrpc: "2.0", id: 1, method: "ping" }])).json?.error?.code,
    ).toBe(-32600);
    expect((await rpcRaw(hub, j.token, "{khong json")).json?.error?.code).toBe(-32700);
  });

  it("HUB-FR-50 · A53 · token job trello → tools/call check-invoice → -32602 'Unknown tool', MK 0 lời gọi; user không có feature chứa workflow vẫn gọi được tool của mình [HUB-H2a-AC-05 · HUB-BR-19]", async () => {
    dify.mock.reset();
    const t = await trello();
    const r = await rpc(t.token, "tools/call", {
      name: WF_KEY.checkInvoice,
      arguments: { x: "HD1" },
    });
    expect(r.json?.error).toMatchObject({ code: -32602, message: "Unknown tool" });
    expect(JSON.stringify(r.json)).not.toMatch(/agent|permission|allowed|trello/i);
    expect(dify.runs().length).toBe(0);
    const h = await hoadon({ who: "hoa" });
    const ok = await toolCall(hub, h.token, WF_KEY.checkInvoice, { x: "HD1" });
    expect(ok.result).toMatchObject({ isError: false });
    expect(dify.runs().length).toBe(1);
    expect(dify.runs()[0]?.body).toMatchObject({ user: `acme:${USERS.hoa.id}` });
  });

  it("HUB-FR-50 · A54 · sửa workflows.description (Admin) → job mới tools/list thấy mô tả mới ≤ 5 000 ms [AC-H12]", async () => {
    const NEW = "Mô tả mới A54: đối chiếu hoá đơn với sổ cái.";
    const t0 = Date.now();
    await catalogChange(
      sql,
      (tx) => tx`update admin.workflows set description = ${NEW} where id = ${WF.checkInvoice}`,
    );
    try {
      const seen = await waitFor(
        async () => {
          const j = await hoadon();
          return (await rpc(j.token, "tools/list")).json?.result?.tools?.[0]?.description;
        },
        (d) => d === NEW,
        5_000,
      );
      expect(seen).toBe(NEW);
      expect(Date.now() - t0).toBeLessThanOrEqual(5_000 + 1_000);
    } finally {
      await catalogChange(
        sql,
        (tx) => tx`update admin.workflows set description = ${DESC} where id = ${WF.checkInvoice}`,
      );
    }
  });
});

describe("A55–A58 · tools/call [HUB-FR-50 · HUB-BR-12 · H2a-R20]", () => {
  it("HUB-BR-12 · A55 · check-invoice {x: 190a+S, y: 250b} → MK đúng 1 lời gọi user acme:<lan>; result text, isError false; bước tool: inputs che trước rồi cắt (x = 190a+***, y = 200b), không LEAK_KEY; không SSE live [HUB-FR-50 · HUB-BR-12 · P12]", async () => {
    dify.mock.reset();
    const j = await hoadon();
    await redis.del(`run:${j.runId}`, `sse:${j.runId}`); // TC-B6-1: id cố định, xoá stream sót lần trước
    const x = "a".repeat(190) + LEAK_INVOICE;
    const y = "b".repeat(250);
    const { res, result } = await toolCall(hub, j.token, WF_KEY.checkInvoice, { x, y });
    expect(res.status).toBe(200);
    expect(result).toEqual({ content: [{ type: "text", text: MOCK_TEXT }], isError: false });
    const runs = dify.runs();
    expect(runs.length).toBe(1);
    expect(runs[0]?.auth).toBe(`Bearer ${LEAK_INVOICE}`);
    expect(runs[0]?.body).toMatchObject({ user: `acme:${USERS.lan.id}`, inputs: { x, y } });
    const steps = await toolSteps(j.runId);
    expect(steps.length).toBe(1);
    expect(steps[0]).toMatchObject({ type: "tool", workflow_id: WF.checkInvoice });
    expect(steps[0]?.detail?.inputs).toEqual({ x: `${"a".repeat(190)}***`, y: "b".repeat(200) });
    const dump = JSON.stringify(steps);
    for (const f of leakForms(LEAK_INVOICE)) expect(dump).not.toContain(f);
    expect(dump).not.toContain("LEAK_KEY");
    expect(await redis.xrange(`sse:${j.runId}`, "-", "+")).toEqual([]);
  });

  it("HUB-FR-50 · A56 · tham số sai → isError 'Invalid arguments…' (MK 0); mk-401 → 'not configured'; mk-failed → 'service returned an error'; usage 1 dòng feature_id NULL mỗi lời gọi Dify [H2a-R20 · H2a-R15]", async () => {
    dify.mock.reset();
    const j = await hoadon();
    for (const bad of [{ x: 123 }, "khong-phai-object", [1, 2]]) {
      const { result } = await toolCall(hub, j.token, WF_KEY.checkInvoice, bad);
      expect(result).toEqual({ content: [{ type: "text", text: MCP_ERR.invalid }], isError: true });
    }
    expect(dify.runs().length).toBe(0);
    try {
      for (const [key, text] of [
        ["mk-401", MCP_ERR.notConfigured],
        ["mk-failed", MCP_ERR.upstream],
      ] as const) {
        await setAppKey(sql, "checkInvoice", key);
        const { result } = await toolCall(hub, j.token, WF_KEY.checkInvoice, { x: "HD-1" });
        expect({ key, result }).toEqual({
          key,
          result: { content: [{ type: "text", text }], isError: true },
        });
      }
    } finally {
      await setAppKey(sql, "checkInvoice", LEAK_INVOICE);
    }
    const ok = await hoadon();
    await toolCall(hub, ok.token, WF_KEY.checkInvoice, { x: "HD-2" });
    const usage = await sql<
      Json[]
    >`select billing, provider_key, feature_id, agent_id from hub.usage_logs
      where run_id = ${ok.runId}`;
    expect([...usage]).toEqual([
      { billing: "dify", provider_key: "dify", feature_id: null, agent_id: AG.hoadon },
    ]);
  });

  it("WRK-FR-13 · A57 · token job tenant beta không thấy/ghi run/flow/tool_confirmations của acme; bước tool chỉ ghi vào run beta [HUB-H2a-AC-05]", async () => {
    const acme = await trello();
    await sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status,
        decided_run_id, decided_at)
      values (${USERS.lan.tid}, ${USERS.lan.id}, ${acme.flowId}, ${acme.runId}, ${AG2.trello}, ${WF.trello},
        'confirmed', ${acme.runId}, now())`;
    const before = await confirmations(sql, acme.flowId);
    const beta = await trello({ who: "an" });
    const { result } = await toolCall(hub, beta.token, WF_KEY.trello, { title: "Thẻ beta" });
    expect(result?.isError).toBe(true);
    expect(await confirmations(sql, acme.flowId)).toEqual(before);
    const mine = await confirmations(sql, beta.flowId);
    expect(mine.map((c) => [c.tenant_id, c.status])).toEqual([[USERS.an.tid, "pending"]]);
    expect((await toolSteps(beta.runId)).length).toBe(1);
    expect(await toolSteps(acme.runId)).toEqual([]);
    const [other] = await sql<{ n: number }[]>`select count(*)::int as n from hub.run_steps
      where type = 'tool' and tenant_id = ${USERS.an.tid} and run_id <> ${beta.runId}`;
    expect(other?.n).toBe(0);
  });

  it("HUB-FR-50 · A58 · timeout tool = min(agents.timeout_s, 300): timeout_s=10 + mk-slow-3000 → 'took too long' + MK nhận stop [H2a-R20 · R55]", async () => {
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.agents set timeout_s = 10 where id = ${AG.hoadon}`,
    );
    await setAppKey(sql, "checkInvoice", "mk-slow-3000");
    try {
      dify.mock.reset();
      await Bun.sleep(300);
      const j = await hoadon();
      const t0 = Date.now();
      const { result } = await toolCall(hub, j.token, WF_KEY.checkInvoice, { x: "HD-3" });
      const ms = Date.now() - t0;
      expect(result).toEqual({ content: [{ type: "text", text: MCP_ERR.timeout }], isError: true });
      expect(ms).toBeGreaterThanOrEqual(9_000);
      expect(ms).toBeLessThanOrEqual(10_000 + 3_000);
      const stops = await waitFor(
        async () => dify.stops(),
        (v) => v.length > 0,
        3_000,
      );
      expect(stops.length).toBeGreaterThan(0);
    } finally {
      await setAppKey(sql, "checkInvoice", LEAK_INVOICE);
      await hubConfigChange(
        sql,
        (tx) => tx`update hub.agents set timeout_s = 60 where id = ${AG.hoadon}`,
      );
    }
  }, 40_000);
});
