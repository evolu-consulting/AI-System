// dlc-engine · luật khe DLC: hình body, KIND_MIX (bước duyệt không trộn với bước DLC), thứ tự dây chuyền, cổng duyệt + quay lại,
// biên dịch ⇒ stage `tool` + `after.review` theo mã Group, dựng lại từ canvas, phân giải Group theo tenant.
import { describe, expect, it } from "bun:test";
import {
  compileDlcStages,
  DLC_GROUP_EDITOR,
  DLC_GROUP_OWNER,
  defaultDlcBody,
  dlcBodyFromStages,
  dlcGroupKeys,
  newDlcStep,
  resolveDlcStages,
  validateDlcBody,
} from "./dlc-flow.rules";

const body = () => defaultDlcBody("enhancement");

describe("dlc-flow · validateDlcBody", () => {
  it("sơ đồ mặc định của cả 3 dây chuyền hợp lệ", () => {
    for (const m of ["new-system", "enhancement", "bug-fix"] as const)
      expect(validateDlcBody(defaultDlcBody(m))).toEqual([]);
  });

  it("body sai hình ⇒ SLOT_SHAPE", () => {
    expect(validateDlcBody(null)).toEqual([{ path: "steps", rule: "SLOT_SHAPE" }]);
    expect(validateDlcBody({ steps: "x" })).toEqual([{ path: "steps", rule: "SLOT_SHAPE" }]);
  });

  it("bước duyệt trộn với bước DLC ⇒ KIND_MIX tại bước lạ đầu tiên", () => {
    const b = body();
    const mixed = {
      steps: [...b.steps.slice(0, 2), { kind: "review", key: "level1", name: "Duyệt" }],
    };
    expect(validateDlcBody(mixed)).toEqual([{ path: "steps.2.kind", rule: "KIND_MIX" }]);
  });

  it("thứ tự dây chuyền: build trước setup ⇒ ORDER_INVALID", () => {
    const b = body();
    const steps = b.steps.filter((s) => s.action !== "setup");
    const issues = validateDlcBody({ steps });
    expect(issues).toContainEqual({ path: "steps.3.action", rule: "ORDER_INVALID" });
  });

  it("việc agent thiếu agent ⇒ AGENT_REQUIRED; khoá trùng ⇒ KEY_DUPLICATE", () => {
    expect(validateDlcBody({ steps: [newDlcStep("a1", "Agent")] })).toEqual([
      { path: "steps.0.agent_key", rule: "AGENT_REQUIRED" },
    ]);
    const s = { ...newDlcStep("a1", "Agent"), agent_key: "dlc-spec" };
    expect(validateDlcBody({ steps: [s, s] })).toEqual([
      { path: "steps.1.key", rule: "KEY_DUPLICATE" },
    ]);
  });

  it("cổng quay lại bước SAU / không tồn tại ⇒ BACK_TARGET_INVALID", () => {
    const b = body();
    const spec = b.steps[1];
    if (!spec) throw new Error("fixture");
    spec.gate = { group_key: DLC_GROUP_EDITOR, back_to: ["qc"] };
    expect(validateDlcBody(b)).toContainEqual({
      path: "steps.1.gate.back_to.0",
      rule: "BACK_TARGET_INVALID",
    });
  });

  it("vòng / hạn ngoài khoảng ⇒ ROUNDS_INVALID / TIMEOUT_INVALID", () => {
    const a = { ...newDlcStep("a1", "A"), agent_key: "x", max_rounds: 0 };
    expect(validateDlcBody({ steps: [a] })).toEqual([
      { path: "steps.0.max_rounds", rule: "ROUNDS_INVALID" },
    ]);
    const t = { ...newDlcStep("a1", "A"), agent_key: "x", timeout_min: 2000 };
    expect(validateDlcBody({ steps: [t] })).toEqual([
      { path: "steps.0.timeout_min", rule: "TIMEOUT_INVALID" },
    ]);
  });
});

describe("dlc-flow · compile / fromStages / resolve", () => {
  it("mỗi bước ⇒ stage `tool` dlc-step ở bước engine = vị trí; cổng ⇒ review theo mã + back_to_steps", () => {
    const st = compileDlcStages(body(), "enhancement");
    expect(st.map((s) => s.key)).toEqual(body().steps.map((s) => s.key));
    expect(st[0]?.executor).toMatchObject({ kind: "tool", tool_key: "dlc-step" });
    expect(st[0]?.after).toEqual({ kind: "auto", branch: [] });
    expect(st[2]?.after).toMatchObject({
      kind: "review",
      group_id: null,
      group_key: DLC_GROUP_EDITOR,
      also_group_keys: [DLC_GROUP_OWNER],
      back_to_steps: [1],
    });
    expect(st[4]?.timeout_s).toBe(1440 * 60);
  });

  it("canvas gửi lại stages ⇒ dựng lại đúng body; stage không mang bước DLC ⇒ {stage}", () => {
    const b = body();
    expect(dlcBodyFromStages(compileDlcStages(b, "enhancement"))).toEqual({ body: b });
    expect(dlcBodyFromStages([{ key: "s0", slot: { kind: "review" } }])).toEqual({ stage: "s0" });
  });

  it("phân giải Group theo tenant; thiếu mã ⇒ null", () => {
    const st = compileDlcStages(body(), "enhancement");
    expect(dlcGroupKeys(body())).toEqual([DLC_GROUP_EDITOR, DLC_GROUP_OWNER]);
    const ids = new Map([
      [DLC_GROUP_EDITOR, "11111111-1111-4111-8111-111111111111"],
      [DLC_GROUP_OWNER, "22222222-2222-4222-8222-222222222222"],
    ]);
    const r = resolveDlcStages(st, ids);
    expect(r?.[1]?.after).toMatchObject({
      group_id: "11111111-1111-4111-8111-111111111111",
      also_group_ids: ["22222222-2222-4222-8222-222222222222"],
    });
    expect(resolveDlcStages(st, new Map())).toBeNull();
  });
});
