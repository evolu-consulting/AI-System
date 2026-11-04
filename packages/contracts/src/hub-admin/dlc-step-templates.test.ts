// dlc-step-library · contract thư viện bước DLC: luật chéo trường (agent bắt buộc cho việc `agent`, `reject_to` chỉ khi có cổng).
import { describe, expect, test } from "bun:test";
import {
  DLC_REJECT_TO,
  DLC_STEP_ACTIONS,
  DlcStepTemplateInputSchema,
  DlcStepTemplateUpdateSchema,
} from "./index";

const base = {
  key: "qc-review",
  name: "Test case",
  action: "qc",
  agent_key: null,
  instruction: "",
  gate_group: "dlc-editor",
  reject_to: "spec",
  max_rounds: 3,
  timeout_min: 240,
} as const;
const ok = (x: unknown) => DlcStepTemplateInputSchema.safeParse(x).success;

describe("dlc-step-library · DlcStepTemplateInputSchema", () => {
  test("nhận bước có cổng + quay lại theo việc; reject_to gồm self/prev + mọi việc", () => {
    expect(ok(base)).toBe(true);
    expect(DLC_REJECT_TO).toEqual(["self", "prev", ...DLC_STEP_ACTIONS]);
  });
  test("việc `agent` thiếu agent_key ⇒ lỗi ở agent_key", () => {
    const r = DlcStepTemplateInputSchema.safeParse({ ...base, action: "agent" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["agent_key"]);
    expect(ok({ ...base, action: "agent", agent_key: "my-agent" })).toBe(true);
  });
  test("reject_to khi không có cổng ⇒ lỗi; không cổng + reject_to null ⇒ hợp lệ", () => {
    expect(ok({ ...base, gate_group: null })).toBe(false);
    expect(ok({ ...base, gate_group: null, reject_to: null })).toBe(true);
  });
  test("khoá / số vòng / hạn ngoài giới hạn ⇒ lỗi; update cần version", () => {
    expect(ok({ ...base, key: "1abc" })).toBe(false);
    expect(ok({ ...base, max_rounds: 11 })).toBe(false);
    expect(ok({ ...base, timeout_min: 4 })).toBe(false);
    expect(DlcStepTemplateUpdateSchema.safeParse(base).success).toBe(false);
    expect(DlcStepTemplateUpdateSchema.safeParse({ ...base, version: 2 }).success).toBe(true);
  });
});
