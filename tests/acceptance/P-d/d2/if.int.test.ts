// CR-103 · fnr-if (flow-node-registry design §3) · node If qua Hub thật: Đúng ⇒ then (bước giữa skipped), Sai + else ⇒ else,
// Sai không else ⇒ bước kế, if lồng, nguồn input. After.branch cũ giữ nguyên (xem `branch.int.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  createDef,
  defBody,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
  runRow,
  stageOf,
  startRun,
  waitStageStatus,
} from "../_support/pd";
import { type CtxD2, needD2, startD2 } from "./_d2";

let c: CtxD2;
beforeAll(async () => {
  c = await startD2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const FIELDS = [{ key: "tong_tien", type: "number", required: true }];
const fieldCond = (op: string, value: number) => ({
  from: { kind: "field", stage_key: "s0", field: "tong_tien" },
  op,
  value,
});
const ifStage = (
  key: string,
  step: number,
  conds: Json[],
  then_step: number,
  else_step: number | null,
  op = "and",
) =>
  agentStage({
    key,
    step,
    executor: { kind: "if", when: { op, conds }, then_step, else_step },
    output: {
      filename: `${key}.md`,
      template: `# ${key}\n\n## Bàn giao\n`,
      required_sections: ["Bàn giao"],
      fields: [],
    },
  });
let seq = 0;
/** s0 (fields tong_tien) → If (bước 1) → s2 (2) → s3 (3) → s4 (4). */
async function def(ifs: Json[], o: Json = {}): Promise<string> {
  const key = `fnr-if-${++seq}`;
  const n = ifs.length;
  await createDef(
    c,
    defBody(
      key,
      [
        agentStage({ key: "s0", step: 0, fields: FIELDS }),
        ...ifs,
        agentStage({ key: "s2", step: 1 + n }),
        agentStage({ key: "s3", step: 2 + n }),
        agentStage({ key: "s4", step: 3 + n }),
      ],
      o,
    ),
  );
  return key;
}
async function runTo(key: string, tong: number, inputs?: Json[]): Promise<string> {
  const runId = await startRun(c, key, { inputs });
  await jobDone(c, await nextStageJob(c, runId), mdOut({ tong_tien: tong }));
  await waitStageStatus(c, runId, 0, "done");
  return runId;
}
const status = async (runId: string, idx: number) => (await stageOf(c.sql, runId, idx))?.status;

describe("CR-103 · node If", () => {
  it("Đúng (and đều đúng) ⇒ nhảy then_step, bước giữa skipped, bước đích có job", async () => {
    await needD2(c);
    const runId = await runTo(
      await def([ifStage("kiem", 1, [fieldCond("gt", 100), fieldCond("lt", 1000)], 3, null)]),
      150,
    );
    await waitStageStatus(c, runId, 1, "done");
    expect(await status(runId, 2)).toBe("skipped");
    expect((await runRow(c.sql, runId))?.current_step).toBe(3);
    const job = await nextStageJob(c, runId);
    expect((await stageOf(c.sql, runId, 3))?.current_run_id).toBe(job.runId);
  }, 30_000);
  it("Sai + có else_step ⇒ nhảy tới bước else", async () => {
    await needD2(c);
    const runId = await runTo(await def([ifStage("kiem", 1, [fieldCond("gt", 100)], 2, 4)]), 50);
    await waitStageStatus(c, runId, 1, "done");
    expect([await status(runId, 2), await status(runId, 3)]).toEqual(["skipped", "skipped"]);
    expect((await runRow(c.sql, runId))?.current_step).toBe(4);
  }, 30_000);
  it("Sai không else_step ⇒ sang bước kế (s2 chạy)", async () => {
    await needD2(c);
    const runId = await runTo(await def([ifStage("kiem", 1, [fieldCond("gt", 100)], 3, null)]), 50);
    await nextStageJob(c, runId);
    expect(await status(runId, 2)).toBe("running");
    expect((await runRow(c.sql, runId))?.current_step).toBe(2);
  }, 30_000);
  it("nguồn input: or một điều kiện đúng ⇒ then", async () => {
    await needD2(c);
    const cond = { from: { kind: "input", key: "muc" }, op: "eq", value: "mua" };
    const key = await def([ifStage("kiem", 1, [fieldCond("gt", 1_000_000), cond], 3, null, "or")], {
      inputs: [{ key: "muc", type: "text", label: "Mục đích", required: true }],
    });
    const runId = await runTo(key, 5, [{ key: "muc", type: "text", text: "mua" }]);
    await waitStageStatus(c, runId, 1, "done");
    expect(await status(runId, 2)).toBe("skipped");
    expect((await runRow(c.sql, runId))?.current_step).toBe(3);
  }, 30_000);
  it("hai If nối tiếp (if lồng) ⇒ đi đúng nhánh của cả hai", async () => {
    await needD2(c);
    // s0 → if1 (bước 1: >100 ⇒ bước 2, sai ⇒ else 3) → if2 (bước 2: >=200 ⇒ bước 4, sai ⇒ bước 3) → s2 (3) → s3 (4) → s4 (5)
    const key = await def([
      ifStage("kiem1", 1, [fieldCond("gt", 100)], 2, 3),
      ifStage("kiem2", 2, [fieldCond("ge", 200)], 4, null),
    ]);
    const runId = await runTo(key, 250);
    await waitStageStatus(c, runId, 2, "done");
    expect(await status(runId, 3)).toBe("skipped"); // s2 (bước 3) bị nhảy qua
    expect((await runRow(c.sql, runId))?.current_step).toBe(4);
  }, 30_000);
  it("6 bước If liên tiếp xong trong MỘT lượt kick (không chờ quét mồ côi)", async () => {
    await needD2(c);
    const ifs = Array.from({ length: 6 }, (_, k) =>
      ifStage(`k${k}`, 1 + k, [fieldCond("gt", 1)], 2 + k, null),
    );
    const runId = await runTo(await def(ifs), 150);
    const job = await nextStageJob(c, runId); // chuỗi 6 If chạy hết, s2 (bước 7) có job
    expect((await stageOf(c.sql, runId, 7))?.current_run_id).toBe(job.runId);
    expect((await runRow(c.sql, runId))?.current_step).toBe(7);
  }, 30_000);
});
