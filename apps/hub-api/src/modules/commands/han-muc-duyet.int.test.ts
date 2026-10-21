// dify-demo-flow · int: lệnh `/han-muc-duyet 600000000 Mua ACME` (catalog dựng từ ĐÚNG đặc tả của `dify-register`) → Hub gọi
// Dify (mock MK sau proxy) với inputs đã ép kiểu → kết quả trả về chat → `hub.dify_runs` + `hub.usage_logs` có dòng; tenant
// khác (chưa bật feature) không thấy lệnh. Không gọi Dify thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  USERS,
} from "../../../../../tests/acceptance/H1/_fixtures";
import {
  AG,
  deltaText,
  type HubX,
  insertConv,
  insertHubConfig,
  openSse,
} from "../../../../../tests/acceptance/H1/_hub";
import {
  type Dify,
  GRP,
  idGen2,
  insertCatalog,
  menuNames,
  startDify,
  startHubH2a,
  stored,
  TEST_MASTER_KEY_B64,
} from "../../../../../tests/acceptance/H2a/_h2a";
import { MOCK_TEXT as TOOL_TEXT, toolCall } from "../../../../../tests/acceptance/H2a/_h2a2";
import { insertSqlJob } from "../../../../../tests/acceptance/H2a/_runtime2";
import {
  HMD_COMMAND,
  HMD_FEATURE,
  HMD_SECRET,
  HMD_WORKFLOW,
} from "../../../../../tools/scripts/src/dify-register.rules";
import { encryptSecret, parseMasterKey } from "../../../../admin-api/src/lib/secret-crypto";

let sql: Sql;
let k: Keys;
let hub: HubX;
let dify: Dify;
const id = idGen2(7300);
const APP_ID = "3f2b8c1e-1111-4222-8333-444455556666";
const ids = { sec: id(), wf: id(), cmd: id(), feat: id() };
const MOCK_TEXT = "Xin chào, đây là mock.";

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  await insertHmd();
  // Workflow cũng là tool của agent `hoadon` (chat thường) — gắn TRƯỚC khi hub nạp cấu hình.
  await sql`insert into hub.agent_workflows (agent_id, workflow_id) values (${AG.hoadon}, ${ids.wf})`;
  k = await makeKeys();
  hub = await startHubH2a(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  await sql?.end();
});

/** Hàng catalog như `dify-register` ghi qua Admin API (secret mã bằng khoá test; key mock `mk-ok`). */
async function insertHmd(): Promise<void> {
  const value = stored("mk-ok");
  const s = encryptSecret(parseMasterKey(TEST_MASTER_KEY_B64), ids.sec, value);
  await sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4) values
    (${ids.sec}, ${HMD_SECRET}, ${Buffer.from(s.ciphertext)}, ${Buffer.from(s.iv)}, 1, ${value.slice(-4)})`;
  const w = HMD_WORKFLOW;
  await sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id, input_schema,
      output_field, dify_app_id, enabled) values (${ids.wf}, ${w.key}, ${w.name}, ${w.description}, ${w.app_type},
      ${dify.baseUrl}, ${ids.sec}, ${sql.json(w.input_schema as never)}, ${w.output_field}, ${APP_ID}, true)`;
  const c = HMD_COMMAND;
  await sql`insert into admin.commands (id, name, aliases, description, workflow_id, args, input_map, output, mode,
      timeout_s, enabled) values (${ids.cmd}, ${c.name}, ${sql.array([])}, ${sql.json(c.description)}, ${ids.wf},
      ${sql.json(c.args as never)}, ${sql.json(c.input_map as never)}, ${sql.json(c.output)}, 'sync', ${c.timeout_s}, true)`;
  await sql`insert into admin.command_names (name, command_id) values (${c.name}, ${ids.cmd})`;
  await sql`insert into admin.features (id, key, name, status) values
    (${ids.feat}, ${HMD_FEATURE.key}, ${sql.json(HMD_FEATURE.name)}, 'on')`;
  await sql`insert into admin.feature_commands (feature_id, command_id) values (${ids.feat}, ${ids.cmd})`;
  await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${ids.feat}, ${USERS.lan.tid})`;
  await sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id) values
    (${USERS.lan.tid}, ${ids.feat}, ${GRP.staff}, null)`;
}

describe("dify-demo-flow · /han-muc-duyet end-to-end (mock Dify)", () => {
  it("lệnh → workflow run (inputs ép kiểu, key mock) → kết quả trong chat → dify_runs + usage_logs; tenant chưa bật không thấy lệnh", async () => {
    expect(await menuNames(hub, await sign(k, USERS.lan))).toContain("han-muc-duyet");
    expect(await menuNames(hub, await sign(k, USERS.an))).not.toContain("han-muc-duyet");

    dify.mock.reset();
    const conv = await insertConv(sql, "lan", id());
    const s = await openSse(hub, "POST", `/conversations/${conv}/messages`, {
      token: await sign(k, USERS.lan),
      body: { content: "/han-muc-duyet 600000000 Mua ACME" },
    });
    try {
      expect(s.status).toBe(200);
      await s.terminal(8_000);
    } finally {
      s.close();
    }
    const calls = dify.runs();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v1/workflows/run");
    expect(calls[0]?.body).toMatchObject({
      inputs: { contract_value: 600000000, contract_type: "Mua", partner_name: "ACME" },
      user: `acme:${USERS.lan.id}`,
    });
    const end = s.events.find((e) => e.event === "run.finished");
    expect(end?.data?.content).toBe(deltaText(s.events));
    expect(end?.data?.content).toBe(MOCK_TEXT);

    const [run] = await sql`select run_id, status, trigger, dify_workflow_run_id from hub.dify_runs
      where workflow_id = ${ids.wf}`;
    expect(run).toMatchObject({ status: "ok", trigger: "command" });
    expect(run?.dify_workflow_run_id).toBeTruthy();
    const usage =
      await sql`select 1 from hub.usage_logs where run_id = ${run?.run_id} and billing = 'dify'`;
    expect(usage).toHaveLength(1);
  });

  it("tool chat thường: inputs đúng kiểu (number/select), số dạng chuỗi → INVALID_ARGS; Dify lỗi trước task_id vẫn ghi dify_runs (trigger agent)", async () => {
    const job = await insertSqlJob(sql, id, {
      type: "agent.cli",
      who: "lan",
      agentId: AG.hoadon,
      agentKey: "hoadon",
      tools: [HMD_WORKFLOW.key],
      mcpUrl: `${hub.base}/mcp`,
    });
    dify.mock.reset();
    const bad = await toolCall(hub, job.token, HMD_WORKFLOW.key, {
      contract_value: "600000000",
      contract_type: "Mua",
    });
    expect(bad.result?.isError).toBe(true);
    expect(dify.runs()).toHaveLength(0);
    const ok = await toolCall(hub, job.token, HMD_WORKFLOW.key, {
      contract_value: 600000000,
      contract_type: "Mua",
    });
    expect(ok.result).toEqual({ content: [{ type: "text", text: TOOL_TEXT }], isError: false });
    expect(dify.runs()[0]?.body).toMatchObject({
      inputs: { contract_value: 600000000, contract_type: "Mua" },
    });
    // Dify từ chối trước khi cấp task_id (mk-400 ≈ "Workflow not published"): lỗi vẫn thấy trong lịch sử chạy.
    const v = stored("mk-400");
    const s = encryptSecret(parseMasterKey(TEST_MASTER_KEY_B64), ids.sec, v);
    await sql`update admin.secrets set ciphertext = ${Buffer.from(s.ciphertext)}, iv = ${Buffer.from(s.iv)} where id = ${ids.sec}`;
    const fail = await toolCall(hub, job.token, HMD_WORKFLOW.key, {
      contract_value: 100,
      contract_type: "Bán",
    });
    expect(fail.result?.isError).toBe(true);
    const rows = await sql`select status, trigger, error_message from hub.dify_runs
      where workflow_id = ${ids.wf} and run_id = ${job.runId} order by created_at`;
    expect(rows.map((r) => [r.status, r.trigger])).toEqual([
      ["ok", "agent"],
      ["failed", "agent"],
    ]);
    expect(String(rows[1]?.error_message)).toContain("400");
  });
});
