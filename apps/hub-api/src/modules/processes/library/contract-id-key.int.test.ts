// CR-122 p17 · int (DB thật, chủ DB): migration hub 0112 đổi khoá `contract-id` → `contract_id` trong def Thư viện (nháp + bản xuất bản),
// bản riêng của công ty, release; KHÔNG đụng snapshot lượt đang chạy (`process_runs`), def `dlc.*`, chữ `contract-id` không có nháy; chạy lại vô hại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";

const MIGRATION = readFileSync(
  join(import.meta.dir, "../../../../../../packages/db/migrations-hub/0112_contract_id_key.sql"),
  "utf8",
);
const OLD_INPUTS = [{ key: "contract-id", label: "Hợp đồng", type: "text", required: true }];
const stagesOf = (key: string, note = "") => [
  {
    key: "ky-so",
    name: `Ký số ${note}`,
    step: 0,
    executor: {
      kind: "tool",
      tool_key: "contracts-esign-send",
      args: { contract_id: { from: "input", key } },
    },
  },
];
const OLD = stagesOf("contract-id", "(contract-id)");

let o: Sql;
let tid = "";
let uid = "";
const id: Record<string, string> = {};

const row = async (q: Promise<{ stages: unknown; inputs: unknown }[]>) => (await q)[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [t] = (await tenants(o, 1, 1226)) as [string];
  tid = t;
  uid = (await users(o, tid, 1, { from: 122_600 }))[0] as string;
  const ins = async (k: string, tenant: string | null, slot: string | null, pub: number | null) => {
    const [r] = await o<{ id: string }[]>`insert into hub.process_defs
      (tenant_id, key, name, stages, inputs, slot, published_version, trigger, app)
      values (${tenant}, ${k}, ${k}, ${o.json(OLD as never)}, ${o.json(OLD_INPUTS as never)}, ${slot}, ${pub},
        ${pub === null ? null : o.json({ event: "contract.submitted" })}, ${pub === null ? null : "contracts"})
      returning id`;
    id[k] = r?.id as string;
  };
  await ins("p17-draft", null, null, null);
  await ins("p17-pub", null, null, 1);
  await ins("p17-company", tid, null, null);
  await ins("p17-dlc", null, "dlc.p17test", null);
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages)
    values (${id["p17-pub"] as string}, 1, 'p17', ${o.json(OLD as never)})`;
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  await o`insert into hub.process_runs (tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
      conversation_id, flow_id, inputs)
    values (${tid}, ${id["p17-pub"] as string}, 1, ${o.json({ key: "p17", stages: OLD } as never)}, ${uid}, 'admin', 'x',
      ${c?.id as string}, gen_random_uuid(), ${o.json([{ type: "text", key: "contract-id", text: "c1" }] as never)})`;
}, 300_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

const defOf = (k: string) =>
  row(
    o<
      { stages: unknown; inputs: unknown }[]
    >`select stages, inputs from hub.process_defs where id = ${id[k] as string}`,
  );

describe("CR-122 p17 · hub 0112 contract-id → contract_id", () => {
  it("def nháp / đã xuất bản / bản riêng công ty / release đổi khoá; set-based, chạy lại vô hại", async () => {
    await o.unsafe(MIGRATION);
    await o.unsafe(MIGRATION);
    for (const k of ["p17-draft", "p17-pub", "p17-company"]) {
      const d = await defOf(k);
      const s = JSON.stringify(d?.stages);
      expect(s).toContain('"key":"contract_id"');
      expect(s).not.toContain('"contract-id"');
      expect(d?.inputs).toEqual([{ ...OLD_INPUTS[0], key: "contract_id" }]);
    }
    const [rel] = await o<{ stages: unknown }[]>`select stages from hub.process_def_releases
      where def_id = ${id["p17-pub"] as string} and rel_version = 1`;
    expect(JSON.stringify(rel?.stages)).toContain('"key":"contract_id"');
    expect(JSON.stringify(rel?.stages)).not.toContain('"contract-id"');
    // chữ `contract-id` không nằm trong nháy JSON-key (tên bước) giữ nguyên
    expect(JSON.stringify(rel?.stages)).toContain("(contract-id)");
  });

  it("snapshot lượt đang chạy và def dlc.* không đổi", async () => {
    const [run] = await o<
      { snapshot: unknown; inputs: unknown }[]
    >`select snapshot, inputs from hub.process_runs
      where tenant_id = ${tid}`;
    expect(JSON.stringify(run?.snapshot)).toContain('"key":"contract-id"');
    expect(run?.inputs).toEqual([{ type: "text", key: "contract-id", text: "c1" }]);
    const dlc = await defOf("p17-dlc");
    expect(JSON.stringify(dlc?.stages)).toContain('"key":"contract-id"');
    expect(dlc?.inputs).toEqual(OLD_INPUTS);
  });
});
