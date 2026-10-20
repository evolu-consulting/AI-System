// M2-chat · m2c (review A-5, A-18) · quyền tool chat NGẮN HẠN cho Dify gọi `/mcp` của Hub. Hub THẬT in-process (DB + Redis thật,
// RLS `contracts_rw`). Mô hình: handle gắn hội thoại (gửi Dify khi mở hội thoại; Dify GIỮ `inputs` lượt đầu) + grant theo run
// (tool đọc, TTL, thu hồi khi run xong) + run phải còn `running`. Ca: hết hạn ⇒ 401; thu hồi ⇒ 401; run không còn chạy ⇒ 401;
// user A không đọc được hàng của B (tenant khác); tenant chưa bật gói ⇒ từ chối; tool ghi không vào grant. Đầu-cuối 2 LƯỢT với
// Dify GIẢ mô phỏng hành vi thật (lượt 2 dùng `inputs` của lượt 1): tool chạy được cả hai lượt, giữa và sau các lượt ⇒ 401.
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
/** Run `running` thật (hội thoại mới) + handle + grant của run đó. */
async function issue(who: Who, keys = READ, t = tokens) {
  const j = await insertSqlJob(c.sql, ids, {
    who,
    type: "agent.cli",
    agentId: AG.assistant,
    agentKey: "assistant",
  });
  const b = {
    tenantId: USERS[who].tid,
    userId: USERS[who].id,
    conversationId: j.convId,
    agentId: AG.assistant,
  };
  const handle = await t.newHandle(b);
  const grant = await t.grant({ ...b, runId: j.runId }, keys, 300);
  if (!grant) throw new Error("không cấp được grant");
  return { handle, grant, runId: j.runId };
}
const call = (tok: string, name: string, args: Record<string, unknown>) =>
  mcp(c.hub, tok, "tools/call", { name, arguments: args });
const dataOf = (r: { json?: { result?: { content?: { text: string }[] } } }) =>
  JSON.parse(r.json?.result?.content?.[0]?.text ?? "null");

describe("M2-chat · m2c · quyền tool chat qua /mcp", () => {
  it("hợp lệ: tools/list chỉ tool đọc; search của lan chỉ thấy HĐ acme", async () => {
    const { handle } = await issue("lan");
    const list = await mcp(c.hub, handle, "tools/list");
    expect(list.status).toBe(200);
    const names = (list.json?.result?.tools ?? []).map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([...READ].sort());
    const s = dataOf(await call(handle, "contracts-search", {}));
    expect(s.items.map((i: { id: string }) => i.id)).toEqual([A1]);
  });

  it("grant hết hạn ⇒ 401 (exp đã qua dù Redis còn giữ khoá)", async () => {
    const past = new ChatToolTokens({
      store: redisChatTokenStore(c.hub.redis),
      packs,
      now: () => Date.now() - 600_000,
    });
    const { handle } = await issue("lan", READ, past);
    expect((await mcp(c.hub, handle, "tools/list")).status).toBe(401);
  });

  it("thu hồi ⇒ 401", async () => {
    const { handle, grant } = await issue("lan");
    expect((await mcp(c.hub, handle, "tools/list")).status).toBe(200);
    await grant.revoke();
    expect((await mcp(c.hub, handle, "tools/list")).status).toBe(401);
  });

  it("A-18 · run không còn `running` (Hub chết, grant chưa thu hồi) ⇒ 401", async () => {
    const { handle, runId } = await issue("lan");
    expect((await mcp(c.hub, handle, "tools/list")).status).toBe(200);
    await c.sql`update hub.runs set status = 'cancelled', error_code = 'CANCELLED',
      error_message = 'x', error_hint = '', finished_at = now()
      where id = ${runId}`;
    expect((await mcp(c.hub, handle, "tools/list")).status).toBe(401);
  });

  it("user A (lan/acme) không đọc được hàng của B (an/beta) — và ngược lại", async () => {
    const lan = (await issue("lan")).handle;
    expect(dataOf(await call(lan, "contracts-get", { contract_id: B1 }))).toEqual({ found: false });
    const an = (await issue("an")).handle;
    expect(dataOf(await call(an, "contracts-get", { contract_id: A1 }))).toEqual({ found: false });
    expect(dataOf(await call(an, "contracts-get", { contract_id: B1 })).found).toBe(true);
  });

  it("tenant chưa bật gói (zed/zeta) ⇒ không tool, gọi bị từ chối, 0 dữ liệu", async () => {
    const { handle } = await issue("zed");
    expect((await mcp(c.hub, handle, "tools/list")).json?.result?.tools ?? []).toEqual([]);
    const r = await call(handle, "contracts-get", { contract_id: A1 });
    expect(r.json?.error?.code).toBe(-32602);
    expect(JSON.stringify(r.json)).not.toContain("Phương Nam");
  });

  it("tool ghi không vào grant; gọi tool ghi ⇒ Unknown tool", async () => {
    const { handle } = await issue("lan", ["contracts-finalize", "contracts-search"]);
    expect((await call(handle, "contracts-finalize", { contract_id: A1 })).json?.error?.code).toBe(
      -32602,
    );
  });

  it("handle sai dạng / không tồn tại ⇒ 401", async () => {
    expect((await mcp(c.hub, "hct_x", "tools/list")).status).toBe(401);
    expect((await mcp(c.hub, `hct_${"A".repeat(43)}`, "tools/list")).status).toBe(401);
  });
});

// ---------- đầu-cuối 2 lượt với Dify giả ----------
const WF = {
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

/** Dify giả như app chat THẬT: hội thoại có `conversation_id` dùng `inputs` của lượt mở, bỏ `inputs` mới. Mỗi lượt gọi tool. */
function fakeDify() {
  const convInputs = new Map<string, Record<string, unknown>>();
  const turns: { token: string; items: string[] | null; status: number }[] = [];
  const dify: Pick<DifyClient, "runStreaming"> = {
    runStreaming: async (req: DifyRunRequest) => {
      const conv = req.conversationId ?? `dify-conv-${convInputs.size + 1}`;
      if (!convInputs.has(conv)) convInputs.set(conv, { ...req.inputs });
      const token = String(convInputs.get(conv)?.[HUB_TOOL_TOKEN_INPUT] ?? "");
      const r = await call(token, "contracts-search", {});
      const items = r.status === 200 ? dataOf(r).items.map((i: { id: string }) => i.id) : null;
      turns.push({ token, items, status: r.status });
      return {
        kind: "finished",
        text: "Có 1 hợp đồng.",
        conversationId: conv,
        taskId: `task-${turns.length}`,
        usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0 },
        ms: 5,
      };
    },
  };
  return { dify, turns };
}

/** Lượt mới (run `running` mới) trong CÙNG hội thoại Hub. */
async function nextRun(convId: string, flowId: string): Promise<string> {
  const [mu, ma, run] = [ids(), ids(), ids()];
  const u = USERS.lan;
  await c.sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id) values
    (${mu}, ${u.tid}, ${u.id}, ${convId}, ${flowId}, 'user', 'hỏi tiếp', null),
    (${ma}, ${u.tid}, ${u.id}, ${convId}, ${flowId}, 'assistant', '', ${run})`;
  await c.sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, owner, lease_until)
    values (${run}, ${u.tid}, ${u.id}, ${convId}, ${flowId}, 'running', 1, ${mu}, ${ma}, 'qc-other-instance',
      now() + interval '1 hour')`;
  return run;
}

describe("M2-chat · m2c · A-5 · Dify giữ inputs lượt đầu — tool chạy cả lượt 2", () => {
  it("2 lượt cùng hội thoại: cùng handle, mỗi lượt có grant riêng; sau mỗi lượt ⇒ 401", async () => {
    const j = await insertSqlJob(c.sql, ids, {
      who: "lan",
      type: "agent.cli",
      agentId: AG.assistant,
      agentKey: "assistant",
    });
    const f = fakeDify();
    const runner = new DifyAgentRunner({
      db: c.hub.db,
      owner: "qc-other-instance",
      catalog: async () => ({ workflows: new Map([[WF.key, WF]]), tenantKeys: new Map() }) as never,
      credentials: { apiKey: async () => "k-m2" },
      dify: f.dify,
      log: logger,
      toolTokens: new ChatToolTokens({ store: redisChatTokenStore(c.hub.redis), packs }),
    });
    const agent = {
      id: AG.assistant,
      key: "mgmt-assistant",
      runtime: "dify-agent",
      runtimeOptions: { workflow_key: WF.key, pack_tools: [...READ, "contracts-finalize"] },
      timeoutS: 60,
    } as unknown as AgentConfig;
    const turn = async (runId: string) => {
      const run = {
        id: runId,
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
        prompt: "HĐ nào?",
        history: [],
      } as unknown as AgentTask;
      const evs = [];
      for await (const ev of runner.run(task, new AbortController().signal)) evs.push(ev);
      return evs.at(-1)?.type;
    };
    expect(await turn(j.runId)).toBe("job.result");
    const handle = f.turns[0]?.token ?? "";
    expect(handle.startsWith("hct_")).toBe(true);
    expect(f.turns[0]).toMatchObject({ status: 200, items: [A1] });
    expect((await mcp(c.hub, handle, "tools/list")).status).toBe(401); // giữa hai lượt

    // lượt 1 kết thúc (một run `running` mỗi flow) rồi mới tới lượt 2
    await c.sql`update hub.runs set status = 'cancelled', error_code = 'CANCELLED',
      error_message = 'x', error_hint = '', finished_at = now()
      where id = ${j.runId}`;
    expect(await turn(await nextRun(j.convId, j.flowId))).toBe("job.result");
    expect(f.turns[1]).toEqual({ token: handle, status: 200, items: [A1] }); // lượt 2 dùng inputs lượt 1 vẫn chạy
    expect((await mcp(c.hub, handle, "tools/list")).status).toBe(401); // sau lượt 2
  });
});
