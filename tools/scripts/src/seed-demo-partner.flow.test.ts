// CR-150 · fix-seed-evolu-flow · quy trình seed (3 demo + Nhận HĐ evolu) phải qua đúng luật kiểm khi lưu của hub (validateProcessDef) — tái hiện 422 PROCESS_DEF_INVALID.
import { describe, expect, it } from "bun:test";
import { ProcessDefInputSchema } from "@ai/contracts/hub-admin";
import { validateProcessDef } from "../../../apps/hub-api/src/modules/processes/defs/def.rules";
import { flowDefPaths } from "../../../apps/hub-api/src/modules/processes/defs/flow-def.rules";
import { bindGroupKeys } from "../../../apps/hub-api/src/modules/processes/public";
import {
  demoFlows,
  type FlowDef,
  receiveFlow,
  seedInputs,
  withEsign,
} from "./seed-demo-partner.data";

const USER = "11111111-1111-4111-8111-111111111111";

/** Như `ensureFlow` của script: gắn id nhóm giả cho mọi mã nhóm, rồi dựng đúng body PUT. */
function check(def: FlowDef) {
  const keys = new Set<string>();
  for (const m of JSON.stringify(def.stages).matchAll(/"group_key":"([^"]+)"/g))
    keys.add(m[1] ?? "");
  const groups = new Map<string, string>([["signers", "22222222-2222-4222-8222-222222222222"]]);
  let n = 0;
  for (const k of keys) groups.set(k, `33333333-3333-4333-8333-${String(++n).padStart(12, "0")}`);
  const stages = withEsign(def.stages, groups.get("signers") ?? "");
  const bound = bindGroupKeys(stages as never, groups, { strip: true });
  const parsed = ProcessDefInputSchema.safeParse({
    key: "uat-flow",
    name: def.name,
    description: "",
    input_hint: "",
    run_group_ids: [],
    stages: bound.stages,
    token_budget: null,
    enabled: true,
    sources: [],
    inputs: seedInputs([]),
    trigger: def.trigger,
    app: "contracts",
  });
  if (!parsed.success) return { zod: parsed.error.issues.slice(0, 5), missing: bound.missing };
  const refs = {
    agentIds: new Set<string>(),
    teamIds: new Set<string>(),
    groupIds: new Set(groups.values()),
    userIds: new Set([USER]),
    tools: new Map([
      [
        "contracts-partner-send",
        {
          key: "contracts-partner-send",
          sideEffect: true,
          params: [
            { name: "contract_id", type: "text", required: true },
            { name: "assignee_group", type: "text", required: false },
            { name: "send_fields", type: "text", required: false },
            { name: "reply_days", type: "number", required: false },
            { name: "message", type: "text", required: false },
            { name: "sign_together", type: "boolean", required: false },
            { name: "sign_reason", type: "text", required: false },
          ],
        },
      ],
      [
        "contracts-esign-send",
        {
          key: "contracts-esign-send",
          sideEffect: true,
          params: [
            { name: "contract_id", type: "text", required: true },
            { name: "provider", type: "text", required: false },
            { name: "company_signers", type: "text", required: false },
          ],
        },
      ],
    ]),
  };
  return {
    missing: bound.missing,
    res: validateProcessDef(parsed.data, refs),
    flow: flowDefPaths(parsed.data, "44444444-4444-4444-8444-444444444444", null),
  };
}

describe("quy trình seed hợp lệ khi lưu", () => {
  it("Nhận HĐ của evolu", () => {
    const r = check(receiveFlow(USER));
    expect(r).toEqual({ missing: [], res: { ok: true }, flow: [] });
  });
  for (const d of demoFlows())
    it(`demo · ${d.name}`, () => {
      expect(check(d)).toEqual({ missing: [], res: { ok: true }, flow: [] });
    });
});

describe("seedInputs", () => {
  it("sơ đồ trống ⇒ thêm contract_id; đã có ⇒ giữ nguyên, không trùng", () => {
    expect(seedInputs(undefined)).toEqual([
      { key: "contract_id", label: "Hợp đồng", type: "text", required: true },
    ]);
    const have = [{ key: "contract_id", label: "x", type: "text", required: true }];
    expect(seedInputs(have)).toEqual(have);
  });
});
