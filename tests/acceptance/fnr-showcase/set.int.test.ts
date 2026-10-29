// CR-103 · R4 fnr-showcase · int: run một def có node `set` qua Hub thật — fields ghi vào output của stage, KHÔNG tạo
// `hub.runs`/agent/job cho stage `set`, run kết thúc `done` không cần AI.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  type CtxPd,
  createDef,
  defBody,
  type Json,
  startPd,
  startRun,
  waitStageStatus,
  waitStatus,
} from "../P-d/_support/pd";
import { hubRunsOfStage, stageOutputs } from "../P-d/d1/_wait";

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
});
