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
  show: "c1051000-0000-4000-8000-000000000005",
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
  await insertDef(c.sql, { id: D.show, tenantId: tid, input: defInput({ key: "pl-show" }) });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type List = { items: { id: string; process: { key: string } }[] };

describe("CR-105 · lượt chạy thử", () => {
  it("lượt chạy thử đánh dấu is_test, ẩn khỏi danh sách mặc định", async () => {
    const run = (id: string, test?: boolean) =>
      c.call("Adm", "POST", `/process-defs/${id}/run`, { input: "x", ...(test ? { test } : {}) });
    const [real, copy, same, show] = [
      await run(D.real),
      await run(D.copy),
      await run(D.sameKey),
      await run(D.show, true), // Showcase gửi cờ `test` rõ ràng (def demo không có source_template_id)
    ];
    expect([real.status, copy.status, same.status, show.status]).toEqual([201, 201, 201, 201]);
    const ids = [real, copy, same, show].map((r) => (r.json as { id: string }).id);
    const flags = await c.sql<
      { key: string; is_test: boolean }[]
    >`select snapshot->>'key' as key, is_test
      from hub.process_runs where id in ${c.sql(ids)}`;
    expect(Object.fromEntries(flags.map((f) => [f.key, f.is_test]))).toEqual({
      "pl-real": false,
      "pl-copy": true,
      "pl-show": true,
      "flow-showcase": false, // trùng key nhưng không phải bản sao mẫu, không cờ ⇒ không phải lượt thử
    });
    const keys = async (q: string) =>
      ((await c.call("Adm", "GET", `/process-runs?scope=tenant${q}`)).json as List).items
        .map((i) => i.process.key)
        .sort();
    expect(await keys("")).toEqual(["flow-showcase", "pl-real"]);
    expect(await keys("&include_test=true")).toEqual([
      "flow-showcase",
      "pl-copy",
      "pl-real",
      "pl-show",
    ]);
  });
});
