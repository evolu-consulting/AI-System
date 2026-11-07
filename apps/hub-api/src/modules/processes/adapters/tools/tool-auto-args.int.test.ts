// CR-122 · A · đường thật (scope system): lượt mở từ `contract.submitted` có input `contract_id` (= ref HĐ); stage tool của node Ký số
// (`args: {}`) đọc qua `loadCallRow` + `toLoad` ⇒ tự nhận `contract_id` thật từ input lượt, KHÔNG cần node Ghi giá trị. Nguồn khai rõ thắng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eventOf, recordInputsOf } from "@ai/contracts/app-manifest";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { bridgeStageOf } from "../../bridge/bridge.rules";
import { type SetExec, setFieldsOf } from "../../domain/set/set.rules";
import { buildToolArgs } from "../../domain/tools/tool-run.rules";
import { autoArgKeys, fieldArgSources, loadCallRow, toLoad } from "./tool-stage-load.repo";

let o: Sql;
let db: Db;
let close: () => Promise<void>;
let tid = "";
let uid = "";
let defId = "";
const CONTRACT = "0f3c2a10-8b1e-4c55-9d7a-1a2b3c4d5e6f";

async function seed(
  args: object,
): Promise<{ runId: string; stageRunId: string; hubRunId: string }> {
  const snap = {
    key: "g1",
    name: "Duyệt HĐ",
    trigger: { event: "contract.submitted" },
    stages: [
      {
        key: "gui-ky",
        name: "Gửi ký số",
        step: 0,
        node: "contracts.esign",
        executor: { kind: "tool", tool_key: "contracts-esign-send", args },
        output: { fields: [] },
      },
    ],
  };
  const inputs = recordInputsOf(eventOf("contracts", "contract.submitted"), CONTRACT, {
    value: 150_000_000,
  });
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, inputs, pack_key, pack_record_id)
    values (${tid}, ${defId}, 1, ${o.json(snap as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), ${o.json(inputs as never)}, 'contracts', ${CONTRACT}) returning id`;
  const hubRunId = crypto.randomUUID();
  const [s] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
    values (${tid}, ${r?.id as string}, 0, 'running') returning id`;
  // `current_run_id` có FK tới `hub.runs` (→ `hub.flows`) ⇒ dựng flow + lần chạy hub của stage trước khi gắn.
  await o`insert into hub.flows (id, tenant_id, user_id, conversation_id, title)
    select r.flow_id, r.tenant_id, r.started_by, r.conversation_id, 'g1'
    from hub.process_runs r where r.id = ${r?.id as string}`;
  await o`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, process_run_id, stage_run_id)
    select ${hubRunId}, r.tenant_id, r.started_by, r.conversation_id, r.flow_id, 'running', 1,
      gen_random_uuid(), gen_random_uuid(), r.id, ${s?.id as string}
    from hub.process_runs r where r.id = ${r?.id as string}`;
  await o`update hub.stage_runs set current_run_id = ${hubRunId} where id = ${s?.id as string}`;
  return { runId: r?.id as string, stageRunId: s?.id as string, hubRunId };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [t] = (await tenants(o, 1, 1225)) as [string];
  tid = t;
  uid = (await users(o, tid, 1, { from: 122_500 }))[0] as string;
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, 'g1', 'g1', ${o.json([{ key: "gui-ky" }])}) returning id`;
  defId = d?.id as string;
  const client = postgres(urls().hubApi, { max: 2, onnotice: () => {} });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
}, 300_000);
afterAll(async () => {
  await close?.();
  await o?.end({ timeout: 2 });
});

const load = (k: Awaited<ReturnType<typeof seed>>) =>
  withHubScope(db, { kind: "system" }, async (tx: Tx) => {
    const row = await loadCallRow(tx, { tenantId: tid, ...k });
    return row ? toLoad(row) : null;
  });

describe("CR-122 · A · Ký số tự nhận bản ghi", () => {
  it("contract.submitted ⇒ Ký số nhận đúng contract_id thật (không cần node Ghi giá trị)", async () => {
    const l = await load(await seed({}));
    expect(l?.args.contract_id).toEqual({ from: "input", key: "contract_id" });
    expect(l?.inputs.get("contract_id")).toBe(CONTRACT);
  });

  it("nguồn khai rõ thắng (args có contract_id ⇒ không ghi đè)", async () => {
    const l = await load(await seed({ contract_id: { from: "const", value: "khac" } }));
    expect(l?.args.contract_id).toEqual({ from: "const", value: "khac" });
  });

  // CR-122 p17 · khoá lệch: lượt chỉ có input `ma_hd`, node Ký số cần `contract_id`. Node Ghi giá trị do AI sinh (`bridgeStageOf`) map
  // ma_hd → contract_id; output của nó phải tới `args` của bước Ký số lúc chạy (loadCallRow → toLoad → buildToolArgs).
  it("cầu nối Ghi giá trị (dạng AI sinh) ⇒ bước Ký số nhận đúng giá trị qua buildToolArgs", async () => {
    const bridge = bridgeStageOf("bridge", [
      { key: "contract_id", type: "string", from: { input: "ma_hd" } },
    ]);
    if (!bridge) throw new Error("bridge stage invalid");
    const exec = bridge.executor as SetExec;
    const { fields } = setFieldsOf(exec, { inputs: { ma_hd: CONTRACT } }, bridge.output.fields);
    const snap = {
      key: "g2",
      name: "Cầu nối",
      stages: [
        { ...bridge, step: 0 },
        {
          key: "gui-ky",
          name: "Gửi ký số",
          step: 1,
          node: "contracts.esign",
          executor: { kind: "tool", tool_key: "contracts-esign-send", args: {} },
          output: { fields: [] },
        },
      ],
    };
    const [c] = await o<
      { id: string }[]
    >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
      values (${tid}, ${uid}, 'c2', 'c2') returning id`;
    const [r] = await o<
      { id: string }[]
    >`insert into hub.process_runs (tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
        conversation_id, flow_id, inputs)
      values (${tid}, ${defId}, 1, ${o.json(snap as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
        gen_random_uuid(), ${o.json([{ type: "text", key: "ma_hd", text: CONTRACT }] as never)}) returning id`;
    const runId = r?.id as string;
    const [s0] = await o<
      { id: string }[]
    >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
      values (${tid}, ${runId}, 0, 'done') returning id`;
    const [out] = await o<
      { id: string }[]
    >`insert into hub.process_outputs (tenant_id, process_run_id, stage_run_id, stage_idx, version, attempt, content,
        template_ok, fields)
      values (${tid}, ${runId}, ${s0?.id as string}, 0, 1, 1, '# b', true, ${o.json(fields as never)}) returning id`;
    await o`update hub.stage_runs set current_output_id = ${out?.id as string} where id = ${s0?.id as string}`;
    const [s1] = await o<
      { id: string }[]
    >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
      values (${tid}, ${runId}, 1, 'running') returning id`;
    await o`insert into hub.flows (id, tenant_id, user_id, conversation_id, title)
      select r.flow_id, r.tenant_id, r.started_by, r.conversation_id, 'g2' from hub.process_runs r where r.id = ${runId}`;
    const hubRunId = crypto.randomUUID();
    await o`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
        user_message_id, answer_message_id, process_run_id, stage_run_id)
      select ${hubRunId}, r.tenant_id, r.started_by, r.conversation_id, r.flow_id, 'running', 1,
        gen_random_uuid(), gen_random_uuid(), r.id, ${s1?.id as string} from hub.process_runs r where r.id = ${runId}`;
    await o`update hub.stage_runs set current_run_id = ${hubRunId} where id = ${s1?.id as string}`;

    const l = await load({ runId, stageRunId: s1?.id as string, hubRunId });
    expect(l?.args.contract_id).toEqual({
      from: "field",
      stageKey: "bridge",
      field: "contract_id",
    });
    const built = buildToolArgs(l?.args ?? {}, l?.inputs ?? new Map(), l?.fields ?? new Map());
    expect(built).toEqual({ ok: true, values: { contract_id: CONTRACT } });
  });

  it("fieldArgSources: bước gần nhất có trường thắng; input lượt / nguồn khai rõ đã chiếm khoá thì không đè", () => {
    const fields = new Map([
      ["a", { x: "1" }],
      ["b", { x: "2" }],
      ["c", null],
    ]);
    expect(fieldArgSources([{ key: "x" }], new Set(), ["c", "b", "a"], fields)).toEqual({
      x: { from: "field", stageKey: "b", field: "x" },
    });
    expect(fieldArgSources([{ key: "x" }], new Set(["x"]), ["b"], fields)).toEqual({});
    expect(fieldArgSources([{ key: "y" }], new Set(), ["b"], fields)).toEqual({});
  });

  it("autoArgKeys: chỉ khoá node cần + có trong input lượt + chưa khai", () => {
    const inputs = new Map([["contract_id", "x"]]);
    expect(autoArgKeys([{ key: "contract_id" }, { key: "y" }], [], inputs)).toEqual([
      "contract_id",
    ]);
    expect(autoArgKeys([{ key: "contract_id" }], ["contract_id"], inputs)).toEqual([]);
  });
});
