// ADM-FR-10, ADM-FR-11 · M2-R07, R08 · workflowSchema (biên mô tả 19/20/400/401, Base URL, tham số), toRequestBody, toToolPreview.
import { describe, expect, test } from "bun:test";
import {
  emptyWorkflowForm,
  type ParamValues,
  parseOptions,
  toRequestBody,
  type WorkflowFormValues,
  workflowSchema,
} from "./schemas";
import { toToolPreview } from "./tool-preview";

const valid = (over: Partial<WorkflowFormValues> = {}): WorkflowFormValues => ({
  ...emptyWorkflowForm(),
  key: "translate",
  name: "Translate",
  secret_id: "0190",
  base_url: "https://dify.example.com/v1",
  description: "d".repeat(30),
  ...over,
});
const param = (over: Partial<ParamValues> = {}): ParamValues => ({
  name: "p",
  type: "text",
  required: false,
  description: "Mô tả",
  options: "",
  ...over,
});
const firstMessage = (v: WorkflowFormValues) => {
  const r = workflowSchema.safeParse(v);
  return r.success ? null : (r.error.issues[0]?.message ?? null);
};

describe("ADM-FR-10 · M2-AC07 · workflowSchema", () => {
  test("mô tả: biên 19/20/400/401 sau trim", () => {
    const e = "workflows.error.descLength";
    expect(firstMessage(valid({ description: "d".repeat(19) }))).toBe(e);
    expect(firstMessage(valid({ description: "d".repeat(20) }))).toBeNull();
    expect(firstMessage(valid({ description: "d".repeat(400) }))).toBeNull();
    expect(firstMessage(valid({ description: "d".repeat(401) }))).toBe(e);
    expect(firstMessage(valid({ description: `  ${"d".repeat(19)}  ` }))).toBe(e);
  });

  test("key: chữ thường/số/-, 2–32; chuẩn hoá chữ hoa", () => {
    expect(firstMessage(valid({ key: "a" }))).toBe("workflows.error.keyFormat");
    expect(firstMessage(valid({ key: "Has Space" }))).toBe("workflows.error.keyFormat");
    expect(firstMessage(valid({ key: "Report-Tax" }))).toBeNull();
  });

  test("Base URL: http/https, không userinfo", () => {
    const e = "workflows.error.baseUrl";
    expect(firstMessage(valid({ base_url: "" }))).toBe(e);
    expect(firstMessage(valid({ base_url: "ftp://x.example.com" }))).toBe(e);
    expect(firstMessage(valid({ base_url: "https://u:p@x.example.com" }))).toBe(e);
    expect(firstMessage(valid({ base_url: "http://x.example.com" }))).toBeNull();
  });

  test("bắt buộc: tên, secret", () => {
    expect(firstMessage(valid({ name: "  " }))).toBe("workflows.error.nameRequired");
    expect(firstMessage(valid({ secret_id: "" }))).toBe("workflows.error.secretRequired");
  });

  test("tham số: tên hợp lệ, không trùng, mô tả bắt buộc, select cần lựa chọn", () => {
    const run = (input_schema: ParamValues[]) => firstMessage(valid({ input_schema }));
    expect(run([param({ name: "1x" })])).toBe("workflows.error.paramName");
    expect(run([param({ name: "a" }), param({ name: "a" })])).toBe("workflows.error.paramDup");
    expect(run([param({ description: "  " })])).toBe("workflows.error.paramDesc");
    expect(run([param({ type: "select", options: " , " })])).toBe(
      "workflows.error.optionsRequired",
    );
    expect(run([param({ type: "select", options: "a, b" })])).toBeNull();
    expect(run([param({ type: "select", options: "x".repeat(101) })])).toBe(
      "workflows.error.optionsLimit",
    );
  });

  test("tối đa 50 tham số", () => {
    const many = Array.from({ length: 51 }, (_, i) => param({ name: `p${i}` }));
    expect(firstMessage(valid({ input_schema: many }))).toBe("workflows.schema.max");
    expect(firstMessage(valid({ input_schema: many.slice(0, 50) }))).toBeNull();
  });
});

describe("ADM-FR-11 · toRequestBody / parseOptions", () => {
  test("parseOptions: trim, bỏ rỗng, bỏ trùng, giữ thứ tự", () => {
    expect(parseOptions("b, a, b,, ")).toEqual(["b", "a"]);
  });

  test("body: output_field rỗng → null; options chỉ có khi select; mô tả trim", () => {
    const body = toRequestBody(
      valid({
        description: `  ${"d".repeat(25)} `,
        input_schema: [param({ type: "select", options: "x, y", description: " m " }), param()],
      }),
    );
    expect(body.output_field).toBeNull();
    expect(body.description).toBe("d".repeat(25));
    expect(body.input_schema[0]).toEqual({
      name: "p",
      type: "select",
      required: false,
      description: "m",
      options: ["x", "y"],
    });
    expect("options" in (body.input_schema[1] ?? {})).toBe(false);
  });
});

describe("ADM-FR-11 · toToolPreview", () => {
  test("ánh xạ kiểu, enum cho select, danh sách required, bỏ tham số chưa đặt tên", () => {
    const p = toToolPreview({
      key: "translate",
      description: " Dịch văn bản ",
      input_schema: [
        param({ name: "source_text", required: true }),
        param({ name: "mode", type: "select", options: "fast, slow" }),
        param({ name: "doc", type: "file" }),
        param({ name: "n", type: "number" }),
        param({ name: "" }),
      ],
    });
    expect(p.name).toBe("translate");
    expect(p.description).toBe("Dịch văn bản");
    expect(p.parameters.mode).toEqual({
      type: "string",
      description: "Mô tả",
      enum: ["fast", "slow"],
    });
    expect(p.parameters.doc?.type).toBe("string");
    expect(p.parameters.n?.type).toBe("number");
    expect(Object.keys(p.parameters)).toEqual(["source_text", "mode", "doc", "n"]);
    expect(p.required).toEqual(["source_text"]);
  });
});
