// CR-105 · L2b · int: lượt mở từ Showcase/RunDialog của mẫu (`flow-showcase`) có `is_test`; danh sách lượt mặc định ẩn,
// `?include_test=true` mới thấy. Lượt từ quy trình thường vẫn `is_test=false`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, PA, startPa } from "../../../../../../tests/acceptance/P-a/_support/pa";
import {
  defInput,
  insertDef,
} from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";

const D = {
  real: "c1051000-0000-4000-8000-000000000001",
  tpl: "c1051000-0000-4000-8000-000000000002",
};

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  const tid = PA.Adm.tid;
  await insertDef(c.sql, { id: D.real, tenantId: tid, input: defInput({ key: "pl-real" }) });
  await insertDef(c.sql, { id: D.tpl, tenantId: tid, input: defInput({ key: "flow-showcase" }) });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type List = { items: { id: string; process: { key: string } }[] };

describe("CR-105 · lượt chạy thử", () => {
  it("lượt chạy thử đánh dấu is_test, ẩn khỏi danh sách mặc định", async () => {
    const real = await c.call("Adm", "POST", `/process-defs/${D.real}/run`, { input: "x" });
    const test = await c.call("Adm", "POST", `/process-defs/${D.tpl}/run`, { input: "x" });
    expect([real.status, test.status]).toEqual([201, 201]);
    const flags = await c.sql<
      { key: string; is_test: boolean }[]
    >`select snapshot->>'key' as key, is_test
      from hub.process_runs where id in (${(real.json as { id: string }).id}, ${(test.json as { id: string }).id})`;
    expect(Object.fromEntries(flags.map((f) => [f.key, f.is_test]))).toEqual({
      "pl-real": false,
      "flow-showcase": true,
    });
    const keys = async (q: string) =>
      ((await c.call("Adm", "GET", `/process-runs?scope=tenant${q}`)).json as List).items
        .map((i) => i.process.key)
        .sort();
    expect(await keys("")).toEqual(["pl-real"]);
    expect(await keys("&include_test=true")).toEqual(["flow-showcase", "pl-real"]);
  });
});
