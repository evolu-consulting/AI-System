// CR-118 · cr118-form-node · unit: FORM_INVALID (after phải review, không real_action, output.fields khớp trường) + ép stage.
import { describe, expect, test } from "bun:test";
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import { ensureFormStage, formDefIssues } from "./node";

const FIELDS = [
  { key: "so_tien", label: "Số tiền", type: "money", required: true, min: 0 },
  { key: "ngay", label: "Ngày", type: "date", required: false },
];
const stage = (o: Record<string, unknown> = {}) => ({
  key: "dien",
  name: "Điền",
  executor: { kind: "form", fields: FIELDS },
  instruction: "x",
  output: {
    filename: "dien.md",
    template: "# t\n",
    required_sections: ["A"],
    fields: [
      { key: "so_tien", type: "number", required: true },
      { key: "ngay", type: "date", required: false },
    ],
  },
  after: { kind: "review", group_id: null },
  real_action: false,
  answerer: { kind: "user", user_id: "u" },
  timeout_s: 600,
  token_budget: 5000,
  sources: [{ source_key: "s" }],
  must_know: ["m"],
  autofix: null,
  ...o,
});
const def = (s: unknown) => ({ stages: [s] }) as unknown as ProcessDefInput;

describe("CR-118 · node form (def)", () => {
  test("hợp lệ ⇒ không lỗi", () => {
    expect(formDefIssues(def(stage()))).toEqual([]);
  });
  test("after auto / real_action / output.fields lệch ⇒ FORM_INVALID đúng path", () => {
    const bad = stage({
      after: { kind: "auto" },
      real_action: true,
      output: { ...stage().output, fields: [{ key: "so_tien", type: "string", required: true }] },
    });
    expect(formDefIssues(def(bad)).map((i) => `${i.path}:${i.rule}`)).toEqual([
      "stages.0.after:FORM_INVALID",
      "stages.0.real_action:FORM_INVALID",
      "stages.0.output.fields:FORM_INVALID",
    ]);
  });
  test("ensureFormStage ép template/mục/fields(required false)/answerer/nguồn", () => {
    const s = ensureFormStage(stage() as never) as unknown as ReturnType<typeof stage>;
    expect(s.output.fields).toEqual([
      { key: "so_tien", type: "number", required: false },
      { key: "ngay", type: "date", required: false },
    ]);
    expect(s.output.required_sections).toEqual(["Kết quả"]);
    expect([s.answerer, s.token_budget, s.sources, s.must_know] as unknown[]).toEqual([
      { kind: "starter" },
      null,
      [],
      [],
    ]);
  });
});
