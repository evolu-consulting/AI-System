// CR-118 · UW-FR-10..14 · contract flow runtime: round-trip (parse ∘ JSON = đồng nhất), giới hạn form, validator từ snapshot,
// lô summary ≤ 100, exhaustive renderer map (typecheck).
import { describe, expect, test } from "bun:test";
import {
  FLOW_STEP_KINDS,
  FlowActionRequestSchema,
  type FlowForm,
  FlowFormSchema,
  type FlowStepRenderers,
  type FlowSummary,
  FlowSummaryRequestSchema,
  FlowSummarySchema,
  type FlowView,
  FlowViewSchema,
  flowFormValuesSchema,
} from "./index";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = {
  status: "pending" as const,
  assignee: null,
  due_at: null,
  overdue: false,
  escalated: false,
  escalated_to: null,
  decided_by: null,
  decided_at: null,
  decided_as: null,
  feedback: null,
  skip_when: null,
};
const FORM: FlowForm = FlowFormSchema.parse({
  fields: [
    { key: "ly_do", label: "Lý do", type: "textarea", required: true, max_len: 500 },
    { key: "so_tien", label: "Số tiền", type: "number", min: 0, integer: true },
    { key: "han", label: "Hạn", type: "date", min: "2026-01-01" },
    { key: "loai", label: "Loại", type: "select", options: [{ value: "a", label: "A" }] },
    { key: "dong_y", label: "Đồng ý", type: "checkbox" },
    { key: "tep", label: "Tệp", type: "file_ref", max_files: 2, accept: "pdf" },
    { key: "ghi_chu", label: "Ghi chú", type: "text" },
  ],
});

const VIEW: FlowView = {
  slot: "contracts.approval",
  ref: U(1),
  run: { id: U(2), mode: "engine", status: "waiting_review", snapshot_version: 3 },
  state: "running",
  phase: "level1",
  note: null,
  attention: null,
  block_reason: null,
  steps: [
    {
      ...base,
      kind: "review",
      key: "s0",
      name: "Kế toán",
      status: "open",
      assignee: { kind: "group", id: U(3), label: null, head_only: false },
      due_at: "2026-11-04T10:00:00.000Z",
      skip_when: null,
    },
    { ...base, kind: "dify", key: "s1", name: "AI soát", assignee: { kind: "system" } },
    {
      ...base,
      kind: "esign",
      key: "ky",
      name: "Ký số",
      esign: { provider_status: "pending", reason: null, can_resend: false, reminded_at: null },
    },
    { ...base, kind: "form", key: "f", name: "Bổ sung", form: FORM },
    { ...base, kind: "wait", key: "w", name: "Chờ", until: null },
    { ...base, kind: "system", key: "x", name: "Hệ thống" },
  ],
  tasks: [
    {
      task_id: U(4),
      step_key: "s0",
      kind: "review",
      actions: [
        {
          key: "approve",
          label: "Duyệt",
          style: "primary",
          confirm: false,
          input: { kind: "extension", key: "contracts.product-links", required: false },
        },
        {
          key: "reject",
          label: "Từ chối",
          style: "danger",
          confirm: true,
          input: { kind: "feedback", required: true, max_len: 4000 },
        },
        {
          key: "f",
          label: "Gửi",
          style: "default",
          confirm: false,
          input: { kind: "form", form: FORM },
        },
      ],
    },
  ],
};

describe("CR-118 contract flow", () => {
  test("FlowView round-trip: mọi loại bước + mọi kiểu đầu vào hành động", () => {
    const back = FlowViewSchema.parse(JSON.parse(JSON.stringify(VIEW)));
    expect(back).toEqual(VIEW);
    expect(new Set(back.steps.map((s) => s.kind))).toEqual(new Set(FLOW_STEP_KINDS));
  });

  test("FlowView strict: trường lạ / loại bước lạ bị từ chối", () => {
    expect(FlowViewSchema.safeParse({ ...VIEW, html: "<b>" }).success).toBe(false);
    const bad = { ...VIEW, steps: [{ ...VIEW.steps[0], kind: "script" }] };
    expect(FlowViewSchema.safeParse(bad).success).toBe(false);
  });

  test("form: nhãn HTML, > 20 trường, khoá trùng, kiểu lạ ⇒ từ chối", () => {
    const f = (fields: unknown[]) => FlowFormSchema.safeParse({ fields }).success;
    expect(f([{ key: "a", label: "<script>x</script>", type: "text" }])).toBe(false);
    expect(f([{ key: "a", label: "A", type: "html" }])).toBe(false);
    expect(f([{ key: "a", label: "A", type: "text", expr: "1+1" }])).toBe(false);
    expect(
      f([
        { key: "a", label: "A", type: "text" },
        { key: "a", label: "B", type: "text" },
      ]),
    ).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({
      key: `k${i}`,
      label: "A",
      type: "checkbox",
    }));
    expect(f(many)).toBe(false);
    expect(f(many.slice(0, 20))).toBe(true);
    expect(f([{ key: "a", label: "A", type: "text", max_len: 501 }])).toBe(false);
  });

  test("validator từ form snapshot: strict, giới hạn, bắt buộc", () => {
    const v = flowFormValuesSchema(FORM);
    expect(
      v.safeParse({ ly_do: "ok", so_tien: 5, han: "2026-02-01", loai: "a", tep: [U(9)] }).success,
    ).toBe(true);
    expect(v.safeParse({}).success).toBe(false); // thiếu bắt buộc
    expect(v.safeParse({ ly_do: "ok", la: 1 }).success).toBe(false); // trường lạ
    expect(v.safeParse({ ly_do: "x".repeat(501) }).success).toBe(false);
    expect(v.safeParse({ ly_do: "ok", so_tien: 1.5 }).success).toBe(false);
    expect(v.safeParse({ ly_do: "ok", han: "2025-12-31" }).success).toBe(false);
    expect(v.safeParse({ ly_do: "ok", loai: "z" }).success).toBe(false);
    expect(v.safeParse({ ly_do: "ok", tep: [U(1), U(2), U(3)] }).success).toBe(false);
    expect(v.safeParse({ ly_do: "a\u0000" }).success).toBe(false);
  });

  test("action request + summary: round-trip, lô ≤ 100, ref trùng ⇒ từ chối", () => {
    const req = { feedback: "Sửa", values: { ly_do: "x" } };
    expect(FlowActionRequestSchema.parse(JSON.parse(JSON.stringify(req)))).toEqual(req);
    expect(FlowActionRequestSchema.safeParse({ other: 1 }).success).toBe(false);
    const refs = Array.from({ length: 100 }, (_, i) => U(i));
    expect(FlowSummaryRequestSchema.safeParse({ refs }).success).toBe(true);
    expect(FlowSummaryRequestSchema.safeParse({ refs: [...refs, U(100)] }).success).toBe(false);
    expect(FlowSummaryRequestSchema.safeParse({ refs: [U(1), U(1)] }).success).toBe(false);
    const sum: FlowSummary = {
      slot: "contracts.approval",
      items: [
        { ref: U(1), state: "running", phase: "level1", snapshot_version: 2, attention: false },
      ],
    };
    expect(FlowSummarySchema.parse(JSON.parse(JSON.stringify(sum)))).toEqual(sum);
  });

  test("renderer map exhaustive (thiếu loại ⇒ lỗi typecheck)", () => {
    const r: FlowStepRenderers<string> = {
      review: (s) => s.kind,
      dify: (s) => s.kind,
      esign: (s) => s.esign.provider_status,
      form: (s) => String(s.form.fields.length),
      wait: (s) => String(s.until),
      system: (s) => s.kind,
    };
    // @ts-expect-error — thiếu `form` phải là lỗi typecheck
    const missing: FlowStepRenderers<string> = {
      review: r.review,
      dify: r.dify,
      esign: r.esign,
      wait: r.wait,
      system: r.system,
    };
    expect(Object.keys(r).sort()).toEqual([...FLOW_STEP_KINDS].sort());
    expect(Object.keys(missing)).toHaveLength(5);
  });
});
