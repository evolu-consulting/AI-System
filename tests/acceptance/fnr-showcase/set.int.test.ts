// CR-103 · R4 fnr-showcase · int: run một def có node `set` qua Hub thật — fields ghi vào output của stage, KHÔNG tạo
// `hub.runs`/agent/job cho stage `set`, run kết thúc `done` không cần AI.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  type CtxPd,
  createDef,
  defBody,
  G1,
  type Json,
  startPd,
  startRun,
  waitStageStatus,
  waitStatus,
} from "../P-d/_support/pd";
import { hubRunsOfStage, stageOutputs } from "../P-d/d1/_wait";
import { settled } from "../P-d/d2/_d2";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const F = (key: string, type: string) => ({ key, type, required: true });
const setStage = (o: Json): Json => ({
  ...agentStage({
    key: o.key,
    step: o.step,
    fields: o.fields,
    executor: { kind: "set", values: o.values },
  }),
  instruction: "",
  output: {
    filename: `${o.key}.md`,
    template: `# ${o.key}\n\n## Kết quả\n`,
    required_sections: ["Kết quả"],
    fields: o.fields,
  },
});

describe("R4 · node set [CR-103]", () => {
  it("set ghi fields từ input + hằng; run done; không hub.runs cho stage set", async () => {
    const def = defBody(
      "fnr-set",
      [
        setStage({
          key: "nhap",
          step: 0,
          fields: [F("amount", "number"), F("purpose", "string")],
          values: [
            { key: "amount", from: { input: "amount" } },
            { key: "purpose", from: { input: "purpose" } },
          ],
        }),
        setStage({
          key: "ket",
          step: 1,
          fields: [F("ket_qua", "string")],
          values: [{ key: "ket_qua", from: { const: "Hoàn tất" } }],
        }),
      ],
      {
        inputs: [
          { key: "amount", label: "Số tiền", type: "number", required: true },
          { key: "purpose", label: "Mục đích", type: "text", required: true },
        ],
      },
    );
    await createDef(c, def);
    const runId = await startRun(c, "fnr-set", {
      inputs: [
        { type: "number", key: "amount", value: "150000000" },
        { type: "text", key: "purpose", text: "mua sắm" },
      ],
    });
    await waitStageStatus(c, runId, 0, "done");
    await waitStageStatus(c, runId, 1, "done");
    await waitStatus(c.sql, runId, "done");
    const [o0] = await stageOutputs(c.sql, runId, 0);
    expect(String(o0?.content)).toContain(
      '```fields\n{"amount":150000000,"purpose":"mua sắm"}\n```',
    );
    const [o1] = await stageOutputs(c.sql, runId, 1);
    expect(String(o1?.content)).toContain('{"ket_qua":"Hoàn tất"}');
    expect([await hubRunsOfStage(c.sql, runId, 0), await hubRunsOfStage(c.sql, runId, 1)]).toEqual([
      0, 0,
    ]);
  }, 60_000);
  it("set + after review ⇒ mở task duyệt, run chờ; Đạt ⇒ bước kế chạy tới done", async () => {
    const def = defBody("fnr-set-rv", [
      {
        ...setStage({
          key: "duyet",
          step: 0,
          fields: [F("y_kien", "string")],
          values: [{ key: "y_kien", from: { const: "Đã xem xét" } }],
        }),
        after: { kind: "review", group_id: G1, back_to_steps: [] },
      },
      setStage({
        key: "ket",
        step: 1,
        fields: [F("ket_qua", "string")],
        values: [{ key: "ket_qua", from: { const: "Hoàn tất" } }],
      }),
    ]);
    await createDef(c, def);
    const runId = await startRun(c, "fnr-set-rv");
    await waitStageStatus(c, runId, 0, "waiting_review");
    const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
      and kind = 'review' and status = 'open' limit 1`;
    expect(t?.id).toBeTruthy();
    expect(await hubRunsOfStage(c.sql, runId, 0)).toBe(0);
    const [s1] = await c.sql<
      Json[]
    >`select status from hub.stage_runs where process_run_id = ${runId}
      and stage_idx = 1`;
    expect(s1?.status).not.toBe("done");
    const res = await c.call("B", "POST", `/review-tasks/${t?.id}/decision`, { result: "pass" });
    expect(res.status).toBe(200);
    await settled(c);
    await waitStageStatus(c, runId, 1, "done");
    await waitStatus(c.sql, runId, "done");
  }, 60_000);
});
