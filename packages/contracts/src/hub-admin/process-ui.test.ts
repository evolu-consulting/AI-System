// CR-103 · fnr-canvas: `stage.ui` (vị trí node canvas, chỉ-UI) — tuỳ chọn, strict, kẹp biên; snapshot cũ (không có `ui`) vẫn đọc được.
import { describe, expect, test } from "bun:test";
import { STAGE_UI_Y, StageUiSchema } from "./process-ui";
import { ProcessStageDefSchema } from "./processes";

const G = "00000000-0000-4000-8000-0000000c0001";
const base = {
  key: "a",
  name: "A",
  executor: { kind: "agent", agent_id: G },
  instruction: "",
  output: { filename: "a.md", template: "# a", required_sections: ["a"], fields: [] },
  after: { kind: "auto" },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
};

describe("StageUiSchema / ProcessStageDefSchema.ui", () => {
  test("ui.y round-trip qua parse; vắng ui (snapshot cũ) ⇒ vẫn hợp lệ và không sinh ui", () => {
    const withUi = ProcessStageDefSchema.parse({ ...base, ui: { y: 215.5 } });
    expect(withUi.ui).toEqual({ y: 215.5 });
    expect(ProcessStageDefSchema.parse(JSON.parse(JSON.stringify(withUi))).ui).toEqual({
      y: 215.5,
    });
    expect("ui" in ProcessStageDefSchema.parse(base)).toBe(false);
  });
  test("strict + biên: khoá lạ, NaN, ngoài biên ⇒ từ chối", () => {
    expect(StageUiSchema.safeParse({ y: 1, x: 2 }).success).toBe(false);
    expect(StageUiSchema.safeParse({ y: Number.NaN }).success).toBe(false);
    expect(StageUiSchema.safeParse({ y: STAGE_UI_Y.max + 1 }).success).toBe(false);
    expect(StageUiSchema.safeParse({ y: STAGE_UI_Y.min }).success).toBe(true);
  });
});
