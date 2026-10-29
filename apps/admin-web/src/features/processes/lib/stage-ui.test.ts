// CR-103 · fnr-canvas: `ui.y` đi vòng def ↔ bản nháp ↔ body gửi Hub (làm tròn, kẹp biên; vắng ⇒ không gửi `ui`).
import { describe, expect, test } from "bun:test";
import { ProcessStageDefSchema, STAGE_UI_Y } from "@ai/contracts/hub-admin";
import { stageToDraft, stageToInput } from "./stage-convert";

const G = "00000000-0000-4000-8000-0000000c0001";
const def = (ui?: { y: number }) =>
  ProcessStageDefSchema.parse({
    key: "a",
    name: "A",
    executor: { kind: "agent", agent_id: G },
    instruction: "",
    output: { filename: "a.md", template: "# a", required_sections: ["a"], fields: [] },
    after: { kind: "auto" },
    real_action: false,
    answerer: { kind: "starter" },
    token_budget: null,
    ...(ui ? { ui } : {}),
  });

describe("ui.y ↔ StageDraft.uiY", () => {
  test("có ui ⇒ uiY; gửi lại ui.y làm tròn", () => {
    const d = stageToDraft(def({ y: 120 }), 0);
    expect(d.uiY).toBe(120);
    expect(stageToInput(d).ui).toEqual({ y: 120 });
    expect(stageToInput({ ...d, uiY: 120.6 }).ui).toEqual({ y: 121 });
  });
  test("vắng ui ⇒ không uiY, không gửi ui; ngoài biên bị kẹp", () => {
    const d = stageToDraft(def(), 0);
    expect(d.uiY).toBeUndefined();
    expect("ui" in stageToInput(d)).toBe(false);
    expect(stageToInput({ ...d, uiY: 1e9 }).ui).toEqual({ y: STAGE_UI_Y.max });
  });
});
