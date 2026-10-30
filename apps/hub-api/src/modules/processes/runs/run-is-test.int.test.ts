// CR-105 · L2b · int: lượt mở từ bản sao của mẫu chạy thử (`source_template_id` → def `tenant_id NULL`, `slot NULL`) có `is_test`;
// danh sách lượt mặc định ẩn, `?include_test=true` mới thấy. Lượt từ quy trình thường — kể cả def tenant trùng key
// `flow-showcase` nhưng không phải bản sao mẫu — vẫn `is_test=false`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, PA, startPa } from "../../../../../../tests/acceptance/P-a/_support/pa";
import {
  defInput,
  insertDef,
} from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";

const D = {
  real: "c1051000-0000-4000-8000-000000000001",
  copy: "c1051000-0000-4000-8000-000000000002",
  tpl: "c1051000-0000-4000-8000-000000000003",
  sameKey: "c1051000-0000-4000-8000-000000000004",
};

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  const tid = PA.Adm.tid;
  await insertDef(c.sql, { id: D.tpl, tenantId: null, input: defInput({ key: "pl-tpl" }) });
  await insertDef(c.sql, { id: D.real, tenantId: tid, input: defInput({ key: "pl-real" }) });
  await insertDef(c.sql, { id: D.copy, tenantId: tid, input: defInput({ key: "pl-copy" }) });
  await c.sql`update hub.process_defs set source_template_id = ${D.tpl} where id = ${D.copy}`;
  await insertDef(c.sql, {
    id: D.sameKey,
    tenantId: tid,
    input: defInput({ key: "flow-showcase" }),
  });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type List = { items: { id: string; process: { key: string } }[] };

describe("CR-105 · lượt chạy thử", () => {
  it("lượt chạy thử đánh dấu is_test, ẩn khỏi danh sách mặc định", async () => {
    const run = (id: string) => c.call("Adm", "POST", `/process-defs/${id}/run`, { input: "x" });
    const [real, copy, same] = [await run(D.real), await run(D.copy), await run(D.sameKey)];
    expect([real.status, copy.status, same.status]).toEqual([201, 201, 201]);
    const ids = [real, copy, same].map((r) => (r.json as { id: string }).id);
    const flags = await c.sql<
      { key: string; is_test: boolean }[]
    >`select snapshot->>'key' as key, is_test
      from hub.process_runs where id in ${c.sql(ids)}`;
    expect(Object.fromEntries(flags.map((f) => [f.key, f.is_test]))).toEqual({
      "pl-real": false,
      "pl-copy": true,
      "flow-showcase": false, // trùng key nhưng không phải bản sao mẫu ⇒ không phải lượt thử
    });
    const keys = async (q: string) =>
      ((await c.call("Adm", "GET", `/process-runs?scope=tenant${q}`)).json as List).items
        .map((i) => i.process.key)
        .sort();
    expect(await keys("")).toEqual(["flow-showcase", "pl-real"]);
    expect(await keys("&include_test=true")).toEqual(["flow-showcase", "pl-copy", "pl-real"]);
  });
});
