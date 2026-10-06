// X1 F4 · HUB-FR-95 · `side_effect` ở form workflow: mặc định false, form ↔ body, response cũ thiếu trường ⇒ false.

import { describe, expect, test } from "bun:test";
import type { Workflow } from "@ai/contracts";
import { emptyWorkflowForm, toFormValues, toRequestBody, workflowSchema } from "./schemas";

const wf = (over: Partial<Workflow> = {}): Workflow =>
  ({
    id: "0190",
    key: "translate",
    name: "Translate",
    app_type: "workflow",
    description: "d".repeat(30),
    enabled: true,
    side_effect: true,
    secret: { id: "s1", name: "dify" },
    base_url: "https://dify.example.com/v1",
    input_schema: [],
    output_field: null,
    ...over,
  }) as Workflow;

describe("X1 F4 · workflow side_effect", () => {
  test("form mới mặc định side_effect=false và body gửi side_effect", () => {
    const v = emptyWorkflowForm();
    expect(v.side_effect).toBe(false);
    expect(toRequestBody({ ...v, side_effect: true }).side_effect).toBe(true);
  });
  test("toFormValues đọc side_effect; response cũ thiếu trường ⇒ false", () => {
    expect(toFormValues(wf()).side_effect).toBe(true);
    const old = wf();
    delete (old as Partial<Workflow>).side_effect;
    expect(toFormValues(old).side_effect).toBe(false);
  });
  test("schema chấp nhận boolean side_effect", () => {
    const v = { ...toFormValues(wf()), secret_id: "s1" };
    expect(workflowSchema.safeParse(v).success).toBe(true);
  });
});
