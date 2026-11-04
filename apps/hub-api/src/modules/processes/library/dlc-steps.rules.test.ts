// dlc-step-library · audit của mẫu bước DLC + danh sách việc của contract = CHECK hub 0071 (gói DLC giữ khớp CHECK ở
// `packs/dlc/domain/dlc-step-seed.rules.test.ts` ⇒ contract = gói, không import chéo gói).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DLC_REJECT_TO, DLC_STEP_ACTIONS } from "@ai/contracts/hub-admin";
import { auditFields, dlcStepAudit } from "./dlc-steps.rules";

const SQL = readFileSync(
  join(import.meta.dir, "../../../../../../packages/db/migrations-hub/0071_dlc_step_templates.sql"),
  "utf8",
);
const listOf = (ck: string): string[] => {
  const m = new RegExp(`${ck} CHECK \\(([^;]*?)\\)\\)?,\\n`, "s").exec(SQL)?.[1] ?? "";
  return [...m.matchAll(/'([a-z-]+)'/g)].map((x) => x[1] as string);
};
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "qc",
  name: "Test case",
  action: "qc",
  agent_key: null,
  instruction: "x".repeat(500),
  gate_group: "dlc-editor",
  reject_to: "spec",
  max_rounds: 3,
  timeout_min: 240,
};

describe("dlc-step-library · luật thư viện bước DLC", () => {
  it("việc / đích quay lại của contract = CHECK 0071", () => {
    expect(listOf("dlc_step_templates_action_ck")).toEqual([...DLC_STEP_ACTIONS]);
    expect(listOf("dlc_step_templates_reject_ck")).toEqual([...DLC_REJECT_TO]);
  });
  it("audit không chép lời dặn (chỉ độ dài); xoá ⇒ after null, before đủ trường", () => {
    expect(auditFields(row)).not.toHaveProperty("instruction");
    expect(auditFields(row)).toMatchObject({ instruction_len: 500, reject_to: "spec" });
    const a = dlcStepAudit("delete", row, row);
    expect(a).toMatchObject({ entity: "dlc_step_template", entityName: "qc", after: null });
    expect(a.before).toMatchObject({ key: "qc", gate_group: "dlc-editor" });
    expect(dlcStepAudit("create", row, null).before).toBeNull();
  });
});
