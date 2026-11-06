// CR-121 c11b · int: `GET /process-runs` trả `record_label` = nhãn nghiệp vụ của bản ghi gắn lượt (mã HĐ thật) qua `recordLabelRegistry`
// (gói contracts đăng ký; một nguồn với trang chi tiết). Theo TẬP: số câu SQL không tăng theo số lượt trong trang. Lượt không gắn bản ghi
// ⇒ null; id HĐ của công ty khác ⇒ null (RLS tenant của gói).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ProcessRunListResponseSchema } from "@ai/contracts/chat";
import { T } from "../../../../../../tests/acceptance/H1/_fixtures";
import { type CtxPa, PA, startPa } from "../../../../../../tests/acceptance/P-a/_support/pa";
import {
  defInput,
  insertDef,
  insertRun,
} from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import { countQueries } from "../../../../../../tests/acceptance/P-d/d1/_count";
import type { Json } from "../../../../../../tests/acceptance/X2b/_x2b";

const DEF = "c1311000-0000-4000-8000-000000000001";
const N = 6;
let c: CtxPa;
const runOf: Record<string, string> = {}; // mã HĐ → run
let plainRun = "";
let foreignRun = "";

beforeAll(async () => {
  c = await startPa();
  const di = defInput({ key: "cr121-label", name: "Duyệt nhãn" });
  await insertDef(c.sql, { id: DEF, tenantId: T.acme, input: di });
  const def = { id: DEF, key: "cr121-label", name: "Duyệt nhãn", stages: di.stages as Json[] };
  const contract = async (tid: string, by: string, number: string, title: string) => {
    const id = crypto.randomUUID();
    await c.sql`insert into contracts.contracts (id, tenant_id, title, created_by, fields)
      values (${id}, ${tid}, ${"file.pdf"}, ${by},
        ${c.sql.json({ number: { value: number }, title: { value: title } })})`;
    return id;
  };
  for (let i = 1; i <= N; i++) {
    const no = `HD-L-00${i}`;
    const cid = await contract(T.acme, PA.A.id, no, `Hợp đồng ${i}`);
    const run = await insertRun(c.sql, { def, startedBy: PA.A, status: "running" });
    await c.sql`update hub.process_runs set pack_key = 'contracts', pack_record_id = ${cid}
      where id = ${run.runId}`;
    runOf[no] = run.runId;
  }
  plainRun = (await insertRun(c.sql, { def, startedBy: PA.A, status: "running" })).runId; // không gắn bản ghi
  // lượt của acme trỏ HĐ của công ty KHÁC (dữ liệu xấu) ⇒ không lộ nhãn
  const other = await contract(T.beta, PA.Db.id, "HD-BETA-001", "Của beta");
  foreignRun = (await insertRun(c.sql, { def, startedBy: PA.A, status: "running" })).runId;
  await c.sql`update hub.process_runs set pack_key = 'contracts', pack_record_id = ${other}
    where id = ${foreignRun}`;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const list = async (limit: number) => {
  const q = await countQueries(c.hub, () =>
    c.call("Adm", "GET", `/process-runs?scope=tenant&limit=${limit}`),
  );
  return { n: q.n, body: ProcessRunListResponseSchema.parse(q.r.json) };
};

describe("CR-121 c11b · nhãn bản ghi của lượt chạy", () => {
  it("nhãn = mã HĐ thật, không gắn bản ghi hoặc HĐ công ty khác ⇒ null", async () => {
    const { body } = await list(50);
    const byId = new Map(body.items.map((i) => [i.id, i.record_label]));
    for (const [no, run] of Object.entries(runOf)) {
      const i = no.slice(-1);
      expect(byId.get(run)).toBe(`HĐ ${no} · Hợp đồng ${i}`);
    }
    expect(byId.get(plainRun)).toBeNull();
    expect(byId.get(foreignRun)).toBeNull();
  });

  it("số câu SQL không tăng theo số lượt trong trang", async () => {
    const small = await list(2);
    const big = await list(50);
    expect(small.body.items.length).toBe(2);
    expect(big.body.items.length).toBeGreaterThanOrEqual(N + 2);
    expect(big.n).toBe(small.n);
  });
});
