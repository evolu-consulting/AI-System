// CR-120 · cr120-contracts-flow · seed hub 0093 (def mặc định khe `contracts.intake`) là JSON tĩnh trong SQL — khớp đúng builder
// `contractsIntakeStages()`; def hợp lệ theo contract + luật node (đổi def mà quên migration mới ⇒ test đỏ).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProcessDefInputBaseSchema, ProcessStageDefSchema } from "@ai/contracts/hub-admin";
import { nodeDefIssues } from "../nodes/registry";
import {
  CONTRACTS_INTAKE_DEF,
  CONTRACTS_INTAKE_INPUTS,
  CONTRACTS_INTAKE_SLOT,
  contractsIntakeStages,
} from "./contracts-intake.def";

const SQL = readFileSync(
  join(
    import.meta.dir,
    "../../../../../../packages/db/migrations-hub/0093_contracts_intake_slot.sql",
  ),
  "utf8",
);
// CR-122 p17 · 0093 bất biến vẫn ghi khoá cũ `contract-id`; hub 0112 đổi thành `contract_id` ⇒ so với builder sau phép đổi đó.
const lits = [...SQL.matchAll(/'(\[\{.*?\}\])'::jsonb/g)].map((m) =>
  JSON.parse((m[1] as string).replaceAll("''", "'").replaceAll('"contract-id"', '"contract_id"')),
);

describe("CR-120 · seed 0093 contracts.intake", () => {
  it("stages trong SQL = builder (đã normalize), inputs khớp, id/khe cố định", () => {
    // CR-122: `normalizeStage` nay tự thêm trường `event` vào output node wait_event; migration 0093 bất biến nên SQL
    // chưa có ⇒ bỏ trường tự thêm khỏi vế builder của stage `signed`; phần còn lại phải khớp tuyệt đối.
    const built = contractsIntakeStages().map((s) =>
      s.key === "signed" ? { ...s, output: { ...s.output, fields: [] } } : s,
    );
    expect(lits.find((j) => Array.isArray(j) && j[0]?.key === "extract")).toEqual(built);
    expect(lits.find((j) => Array.isArray(j) && j[0]?.key === "contract_id")).toEqual(
      CONTRACTS_INTAKE_INPUTS,
    );
    expect(SQL).toContain(`'${CONTRACTS_INTAKE_DEF.id}'`);
    expect(SQL).toContain(`'${CONTRACTS_INTAKE_SLOT}'`);
  });

  it("mỗi stage hợp lệ theo ProcessStageDefSchema; def không vi phạm luật node (WAIT/FORM/SET/TOOL…)", () => {
    const stages = contractsIntakeStages();
    for (const s of stages) expect(ProcessStageDefSchema.safeParse(s).success).toBe(true);
    const def = ProcessDefInputBaseSchema.parse({
      key: CONTRACTS_INTAKE_DEF.key,
      name: CONTRACTS_INTAKE_DEF.name,
      description: CONTRACTS_INTAKE_DEF.description,
      input_hint: CONTRACTS_INTAKE_DEF.inputHint,
      run_group_ids: [],
      stages,
      token_budget: null,
      enabled: true,
      sources: [],
      inputs: CONTRACTS_INTAKE_INPUTS,
    });
    // `tool` cần refs.tools (REF_INVALID xét riêng); ở đây chỉ luật chéo stage của node.
    const issues = nodeDefIssues(def as never, { tools: new Map() } as never).filter(
      (i) => i.rule !== "TOOL_INVALID",
    );
    expect(issues).toEqual([]);
  });

  it("Group theo MÃ (group_id null), không dùng agent_id cố định", () => {
    const stages = contractsIntakeStages();
    const afters = stages.flatMap((s) => (s.after.kind === "review" ? [s.after] : []));
    expect(afters.map((a) => [a.group_key, a.group_id])).toEqual([
      ["contracts-editor", null],
      ["contracts-owner", null],
    ]);
    expect(stages.some((s) => s.executor.kind === "agent")).toBe(false);
    expect(SQL).not.toMatch(/"group_id":"[0-9a-f]{8}-/);
  });
});
