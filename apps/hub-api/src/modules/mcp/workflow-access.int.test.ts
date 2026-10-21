// commands-unfreeze · int: workflow gắn agent là tool của agent trong chat thường (MCP `/mcp` của job agentic-cli), chỉ khi
// tenant của người gọi có entitlement + người gọi có grant của feature của workflow (cùng luật lệnh `/`), kiểm lại ở MỖI
// tools/list + tools/call. Gọi Dify mock (không Dify thật) ⇒ kết quả về model, `hub.dify_runs` (trigger agent) + usage.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  T,
  USERS,
  waitFor,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { AG, type HubX, insertHubConfig, testRedis } from "../../../../../tests/acceptance/H1/_hub";
import {
  catalogChange,
  type Dify,
  FEAT,
  GRP,
  idGen2,
  insertCatalog,
  insertH2aAgents,
  startDify,
  startHubH2a,
  WF,
} from "../../../../../tests/acceptance/H2a/_h2a";
import { MOCK_TEXT, rpcRaw, toolCall } from "../../../../../tests/acceptance/H2a/_h2a2";
import { insertSqlJob, type SqlJobOpts } from "../../../../../tests/acceptance/H2a/_runtime2";
import type { Redis } from "../../lib/redis";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let dify: Dify;
const id = idGen2(9900);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  await insertH2aAgents(sql);
  // `dich` (feature translate: entitlement acme+beta, grant nhóm staff acme / user an beta) gắn thêm cho agent `hoadon`.
  await sql`insert into hub.agent_workflows (agent_id, workflow_id) values (${AG.hoadon}, ${WF.dich})`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
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

const job = (who: SqlJobOpts["who"]) =>
  insertSqlJob(sql, id, {
    type: "agent.cli",
    who,
    agentId: AG.hoadon,
    agentKey: "hoadon",
    tools: ["dich"],
    mcpUrl: `${hub.base}/mcp`,
  });
const names = async (token: string): Promise<string[]> => {
  const r = await rpcRaw(hub, token, { jsonrpc: "2.0", id: "l", method: "tools/list" });
  return (r.json?.result?.tools ?? []).map((t: { name: string }) => t.name);
};

describe("commands-unfreeze · workflow Dify là tool trong chat thường", () => {
  it("người gọi có quyền feature: tool có mô tả + schema từ catalog; gọi ⇒ Dify mock, kết quả về model, dify_runs trigger agent + usage", async () => {
    dify.mock.reset();
    const j = await job("lan");
    expect(await names(j.token)).toContain("dich");
    const r = await rpcRaw(hub, j.token, { jsonrpc: "2.0", id: "l", method: "tools/list" });
    const tool = r.json?.result?.tools.find((t: { name: string }) => t.name === "dich");
    expect(tool.inputSchema.properties).toHaveProperty("target_lang");
    const { result } = await toolCall(hub, j.token, "dich", {
      source_text: "xin",
      target_lang: "en",
    });
    expect(result).toEqual({ content: [{ type: "text", text: MOCK_TEXT }], isError: false });
    expect(dify.runs().map((c) => c.path)).toEqual(["/v1/workflows/run"]);
    const [run] = await sql`select * from hub.dify_runs where run_id = ${j.runId}`;
    expect(run).toMatchObject({
      workflow_id: WF.dich,
      tenant_id: T.acme,
      user_id: USERS.lan.id,
      trigger: "agent",
      status: "ok",
    });
    expect(run?.dify_workflow_run_id).toBeTruthy();
    const usage =
      await sql`select 1 from hub.usage_logs where run_id = ${j.runId} and billing = 'dify'`;
    expect(usage).toHaveLength(1);
  });

  it("tenant không có entitlement (zeta) không được offer tool; gọi thẳng ⇒ unknown tool, 0 lời gọi Dify", async () => {
    dify.mock.reset();
    const j = await job("zed");
    expect(await names(j.token)).not.toContain("dich");
    const { res } = await toolCall(hub, j.token, "dich", { source_text: "x", target_lang: "en" });
    expect(res.json?.error).toBeTruthy();
    expect(dify.runs()).toHaveLength(0);
  });

  it("kiểm lại lúc gọi: thu hồi quyền sau khi cấp token ⇒ tools/call bị từ chối", async () => {
    dify.mock.reset();
    const j = await job("lan");
    expect(await names(j.token)).toContain("dich");
    await catalogChange(
      sql,
      (tx) =>
        tx`delete from admin.feature_grants where feature_id = ${FEAT.translate} and group_id = ${GRP.staff}`,
    );
    // Hub nạp lại cấu hình qua NOTIFY (bất đồng bộ): chờ tới khi cache thấy thu hồi.
    await waitFor(
      async () => (await names(j.token)).includes("dich"),
      (listed) => !listed,
      5_000,
    );
    const { res } = await toolCall(hub, j.token, "dich", { source_text: "x", target_lang: "en" });
    expect(res.json?.error).toBeTruthy();
    expect(dify.runs()).toHaveLength(0);
  });
});
