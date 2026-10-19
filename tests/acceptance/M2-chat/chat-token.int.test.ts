// M2-chat · token tool chat NGẮN HẠN (Dify gọi `/mcp` của Hub) — người dùng duyệt 2026-10-19: gắn user + tenant + run, TTL
// phút, chỉ tool đọc, thu hồi khi run xong, không token dài hạn. Hub THẬT in-process (DB + Redis thật, RLS `contracts_rw`).
// Ca: hết hạn ⇒ 401; thu hồi ⇒ 401; token của user A không đọc được hàng của B (tenant khác); token tenant chưa bật gói ⇒ từ
// chối; tool ghi không bao giờ vào token. Đầu-cuối: `DifyAgentRunner` + Dify GIẢ (transport) — Dify nhận token trong
// `inputs.hub_tool_token`, gọi `/mcp` bằng nó trong lúc chạy (thấy đúng dữ liệu), sau run token chết (401). Không sleep.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { logger } from "../../../apps/hub-api/src/lib/logger";
import type { AgentConfig } from "../../../apps/hub-api/src/modules/config/config.rules";
import { DifyAgentRunner } from "../../../apps/hub-api/src/modules/dify/agent/dify-agent-runner";
import type {
  DifyClient,
  DifyRunRequest,
} from "../../../apps/hub-api/src/modules/dify/dify.client";
import {
  ChatToolTokens,
  HUB_TOOL_TOKEN_INPUT,
  redisChatTokenStore,
} from "../../../apps/hub-api/src/modules/mcp/chat-token";
import type { AgentTask } from "../../../apps/hub-api/src/modules/runner/job/job-agent-runner";
import { USERS } from "../H1/_fixtures";
import { AG, idGen, insertHubConfig } from "../H1/_hub";
import { insertSqlJob, mcp } from "../H2a/_runtime2";
import { arrange, type CtxN1, insContract, startHd1, T } from "../HD1/_support/hd1";

const A1 = "e2c00000-0000-4000-8000-000000000a11";
const B1 = "e2c00000-0000-4000-8000-000000000b11";
const READ = ["contracts-search", "contracts-get"];
const ids = idGen(9_840);
const INFO: Record<string, { sideEffect: boolean; action: "read" | "write" }> = {
  "contracts-search": { sideEffect: false, action: "read" },
  "contracts-get": { sideEffect: false, action: "read" },
  "contracts-finalize": { sideEffect: false, action: "write" },
};
const packs = {
  info: (k: string) =>
    INFO[k] ? { key: k, name: k, description: k, params: [], ...INFO[k] } : undefined,
};

let c: CtxN1;
let tokens: ChatToolTokens;
beforeAll(async () => {
  c = await startHd1();
  await arrange(c);
  await insertHubConfig(c.sql);
  await insContract(c.sql, { id: A1, tenant: T.acme, title: "HĐ Phương Nam M2" });
  await insContract(c.sql, { id: B1, tenant: T.beta, title: "HĐ Canary M2" });
  tokens = new ChatToolTokens({ store: redisChatTokenStore(c.hub.redis), packs });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type Who = "lan" | "an" | "zed";
const claims = (who: Who) => ({
  tenantId: USERS[who].tid,
  userId: USERS[who].id,
  runId: crypto.randomUUID(),
  conversationId: crypto.randomUUID(),
  agentId: AG.assistant,
});
async function issue(who: Who, keys = READ, t = tokens): Promise<string> {
  const tok = await t.issue(claims(who), keys, 300);
  if (!tok) throw new Error("không cấp được token");
  return tok.token;
}
const call = (tok: string, name: string, args: Record<string, unknown>) =>
  mcp(c.hub, tok, "tools/call", { name, arguments: args });
const dataOf = (r: { json?: { result?: { content?: { text: string }[] } } }) =>
  JSON.parse(r.json?.result?.content?.[0]?.text ?? "null");

describe("M2-chat · token tool chat ngắn hạn qua /mcp", () => {
  it("token hợp lệ: tools/list chỉ tool đọc; search của lan chỉ thấy HĐ acme", async () => {
    const tok = await issue("lan");
    const list = await mcp(c.hub, tok, "tools/list");
    expect(list.status).toBe(200);
    const names = (list.json?.result?.tools ?? []).map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([...READ].sort());
    const s = dataOf(await call(tok, "contracts-search", {}));
    expect(s.items.map((i: { id: string }) => i.id)).toEqual([A1]);
  });

  it("hết hạn ⇒ 401 (exp đã qua dù Redis còn giữ khoá)", async () => {
    const past = new ChatToolTokens({
      store: redisChatTokenStore(c.hub.redis),
      packs,
      now: () => Date.now() - 600_000,
    });
    const tok = await issue("lan", READ, past);
    const r = await mcp(c.hub, tok, "tools/list");
    expect(r.status).toBe(401);
  });

  it("thu hồi ⇒ 401", async () => {
    const tok = await tokens.issue(claims("lan"), READ, 300);
    if (!tok) throw new Error("no token");
    expect((await mcp(c.hub, tok.token, "tools/list")).status).toBe(200);
    await tok.revoke();
    expect((await mcp(c.hub, tok.token, "tools/list")).status).toBe(401);
  });

  it("token của user A (lan/acme) không đọc được hàng của B (an/beta) — và ngược lại", async () => {
    const lan = await issue("lan");
    expect(dataOf(await call(lan, "contracts-get", { contract_id: B1 }))).toEqual({ found: false });
    const an = await issue("an");
    expect(dataOf(await call(an, "contracts-get", { contract_id: A1 }))).toEqual({ found: false });
    expect(dataOf(await call(an, "contracts-get", { contract_id: B1 })).found).toBe(true);
  });

  it("token của tenant chưa bật gói (zed/zeta) ⇒ không tool, gọi bị từ chối, 0 dữ liệu", async () => {
    const tok = await issue("zed");
    expect((await mcp(c.hub, tok, "tools/list")).json?.result?.tools ?? []).toEqual([]);
    const r = await call(tok, "contracts-get", { contract_id: A1 });
    expect(r.json?.error?.code).toBe(-32602);
    expect(JSON.stringify(r.json)).not.toContain("Phương Nam");
  });

  it("tool ghi không vào token; gọi tool ghi bằng token ⇒ Unknown tool", async () => {
    const tok = await issue("lan", ["contracts-finalize", "contracts-search"]);
    const r = await call(tok, "contracts-finalize", { contract_id: A1 });
    expect(r.json?.error?.code).toBe(-32602);
  });

  it("token sai dạng / token job giả ⇒ 401", async () => {
    expect((await mcp(c.hub, "hct_x", "tools/list")).status).toBe(401);
    expect((await mcp(c.hub, `hct_${"A".repeat(43)}`, "tools/list")).status).toBe(401);
  });
});

describe("M2-chat · Dify (transport giả) gọi tool bằng token của đúng tin, token chết sau run", () => {
  it("Dify nhận hub_tool_token, gọi /mcp thấy HĐ acme; sau run ⇒ 401", async () => {
    const j = await insertSqlJob(c.sql, ids, {
      who: "lan",
      type: "agent.cli",
      agentId: AG.assistant,
      agentKey: "assistant",
    });
    const seen: { token?: string; during?: unknown } = {};
    const dify: Pick<DifyClient, "runStreaming"> = {
      runStreaming: async (req: DifyRunRequest) => {
        seen.token = String(req.inputs[HUB_TOOL_TOKEN_INPUT] ?? "");
        seen.during = dataOf(await call(seen.token, "contracts-search", {}));
        return {
          kind: "finished",
          text: "Có 1 hợp đồng.",
          conversationId: "dify-conv-1",
          taskId: "task-1",
          usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0 },
          ms: 5,
        };
      },
    };
    const wf = {
      id: crypto.randomUUID(),
      key: "m2-assistant",
      name: "m2",
      description: null,
      appType: "chat" as const,
      baseUrl: "http://dify.invalid/v1",
      secretId: null,
      inputSchema: [
        { name: "query", type: "text", required: true, description: "câu hỏi" },
        { name: HUB_TOOL_TOKEN_INPUT, type: "text", required: false, description: "token" },
      ],
      outputField: null,
      enabled: true,
      sideEffect: false,
    };
    const runner = new DifyAgentRunner({
      db: c.hub.db,
      owner: "qc-other-instance",
      catalog: async () => ({ workflows: new Map([[wf.key, wf]]), tenantKeys: new Map() }) as never,
      credentials: { apiKey: async () => "k-m2" },
      dify,
      log: logger,
      toolTokens: new ChatToolTokens({ store: redisChatTokenStore(c.hub.redis), packs }),
    });
    const agent = {
      id: AG.assistant,
      key: "mgmt-assistant",
      runtime: "dify-agent",
      runtimeOptions: { workflow_key: wf.key, pack_tools: [...READ, "contracts-finalize"] },
      timeoutS: 60,
    } as unknown as AgentConfig;
    const run = {
      id: j.runId,
      tenantId: T.acme,
      userId: USERS.lan.id,
      conversationId: j.convId,
      flowId: j.flowId,
      locale: "vi" as const,
    };
    const task = {
      run,
      agent,
      role: "agent",
      prompt: "có bao nhiêu HĐ?",
      history: [],
    } as unknown as AgentTask;
    const evs = [];
    for await (const ev of runner.run(task, new AbortController().signal)) evs.push(ev);
    expect(evs.at(-1)?.type).toBe("job.result");
    expect(seen.token?.startsWith("hct_")).toBe(true);
    expect((seen.during as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([A1]);
    expect((await mcp(c.hub, seen.token as string, "tools/list")).status).toBe(401);
  });
});
