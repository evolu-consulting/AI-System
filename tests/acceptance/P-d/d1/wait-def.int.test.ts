// AC-H41 · HUB-FR-144 · HUB-BR-42 · test-plan-int §3 PD-I34…I36 (+ plan-addendum A2 path `WAIT_INVALID`, A3 trường Hub
// ép): input `date` lúc bắt đầu (ngày lịch thật), luật lưu def `wait_until` (422 `PROCESS_DEF_INVALID` + path từng ca),
// Hub ép output/answerer/token_budget/timeout_s khi lưu.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  type CtxPd,
  createDef,
  defBody,
  FIELD_NGAY,
  G1,
  type Json,
  needPdSchema,
  PD_DEFS,
  startPd,
  waitStage,
} from "../_support/pd";
import { ensureDef, settle } from "./_wait";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const nRuns = async (): Promise<number> =>
  (await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_runs`)[0]?.n ?? 0;
const startWithHan = (value: string) =>
  c.call("A", "POST", "/process-runs", {
    process_key: "pd-wait-input",
    input: "HS-01",
    origin: { kind: "none" },
    inputs: [{ key: "han", type: "date", value }],
  });
/** 422 PROCESS_DEF_INVALID ⇒ rule tại `path` (paths/rules cùng chỉ số, mẫu P-b2 DF). */
function ruleAt(r: { status: number; json: Json }, path: string): string | undefined {
  expect({ status: r.status, code: r.json?.error?.code }).toEqual({
    status: 422,
    code: "PROCESS_DEF_INVALID",
  });
  const paths = (r.json?.error?.details?.paths ?? []) as string[];
  const rules = (r.json?.error?.details?.rules ?? []) as string[];
  expect(rules.length).toBe(paths.length);
  expect(rules).toContain("WAIT_INVALID");
  expect(paths).toContain(path);
  return rules[paths.indexOf(path)];
}
const HAN_TEXT = [{ key: "han", type: "text", label: "Hạn", required: true }];

describe("PD-I34 · input date lúc bắt đầu [AC-H41][HUB-FR-105]", () => {
  it("AC-H41 · PD-I34 · `2026-02-30` ⇒ 400 path inputs.0.value, 0 run; `2026-2-3` ⇒ 400; `2026-02-28` ⇒ 201", async () => {
    needPdSchema(c.pd);
    await settle(c.sql);
    await ensureDef(c, PD_DEFS.waitInput());
    const r0 = await nRuns();
    const bad = await startWithHan("2026-02-30");
    expect({ status: bad.status, code: bad.json?.error?.code }).toEqual({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    expect(bad.json?.error?.details?.issues?.[0]?.path).toEqual(["inputs", 0, "value"]);
    expect(await nRuns()).toBe(r0);
    const short = await startWithHan("2026-2-3");
    expect({ status: short.status, code: short.json?.error?.code }).toEqual({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    expect(await nRuns()).toBe(r0);
    const ok = await startWithHan("2026-02-28");
    expect({ status: ok.status, code: ok.json?.error?.code ?? null }).toEqual({
      status: 201,
      code: null,
    });
    expect(await nRuns()).toBe(r0 + 1);
  }, 60_000);
});

describe("PD-I35 · WAIT_INVALID khi lưu def [AC-H41][HUB-BR-42][plan-addendum A2]", () => {
  const post = (body: Json) => c.call("Adm", "POST", "/process-defs", body);
  it("HUB-BR-42 · PD-I35 · after review ⇒ path stages.1.after", async () => {
    needPdSchema(c.pd);
    const body = defBody("pd-wi-after", [
      agentStage({ key: "doc", step: 0, fields: FIELD_NGAY }),
      waitStage({
        key: "cho",
        step: 1,
        after: { kind: "review", group_id: G1, back_to_steps: [] },
      }),
    ]);
    expect(ruleAt(await post(body), "stages.1.after")).toBe("WAIT_INVALID");
  }, 30_000);
  it("HUB-BR-42 · PD-I35 · real_action true ⇒ path stages.1.executor", async () => {
    needPdSchema(c.pd);
    const body = defBody("pd-wi-real", [
      agentStage({ key: "doc", step: 0, fields: FIELD_NGAY }),
      waitStage({ key: "cho", step: 1, real_action: true }),
    ]);
    expect(ruleAt(await post(body), "stages.1.executor")).toBe("WAIT_INVALID");
  }, 30_000);
  it("HUB-BR-42 · PD-I35 · nguồn field ở cùng bước ⇒ path stages.1.executor.from", async () => {
    needPdSchema(c.pd);
    const body = defBody("pd-wi-same", [
      agentStage({ key: "doc", step: 0, fields: FIELD_NGAY }),
      waitStage({ key: "cho", step: 0 }),
    ]);
    expect(ruleAt(await post(body), "stages.1.executor.from")).toBe("WAIT_INVALID");
  }, 30_000);
  it("HUB-BR-42 · PD-I35 · nguồn input kiểu text ⇒ path stages.1.executor.from", async () => {
    needPdSchema(c.pd);
    const body = defBody(
      "pd-wi-text",
      [
        agentStage({ key: "doc", step: 0 }),
        waitStage({ key: "cho", step: 1, from: { kind: "input", key: "han" } }),
      ],
      { inputs: HAN_TEXT },
    );
    expect(ruleAt(await post(body), "stages.1.executor.from")).toBe("WAIT_INVALID");
  }, 30_000);
});

describe("PD-I36 · Hub ép trường stage wait_until khi lưu [AC-H41][plan-addendum A3]", () => {
  it("AC-H41 · PD-I36 · template/sections/fields/answerer/token_budget/timeout_s gửi tuỳ ý ⇒ lưu giá trị ép; filename giữ", async () => {
    needPdSchema(c.pd);
    const wait = {
      ...waitStage({
        key: "cho",
        step: 1,
        output: {
          filename: "cho.md",
          template: "## Tuỳ ý\n",
          required_sections: ["Tuỳ ý"],
          fields: FIELD_NGAY,
        },
      }),
      answerer: { kind: "group", group_id: G1 },
      token_budget: 50_000,
      timeout_s: 1800,
    };
    const body = {
      ...defBody("pd-wait-ep", [agentStage({ key: "doc", step: 0, fields: FIELD_NGAY }), wait]),
      ttl_days: 30,
    };
    const forced = {
      output: {
        filename: "cho.md",
        template: "# {name}\n\n## Bàn giao\n",
        required_sections: ["Bàn giao"],
        fields: [],
      },
      answerer: { kind: "starter" },
      token_budget: null,
      timeout_s: 600, // STAGE_TIMEOUT_S.default (contract chat/processes.ts)
    };
    const created = await createDef(c, body);
    expect(created.stages?.[1]).toMatchObject(forced);
    const got = await c.call("Adm", "GET", `/process-defs/${created.id}`);
    expect(got.status).toBe(200);
    expect(got.json?.stages?.[1]).toMatchObject(forced);
    expect(got.json?.stages?.[1]?.output?.fields).toEqual([]);
  }, 30_000);
});
