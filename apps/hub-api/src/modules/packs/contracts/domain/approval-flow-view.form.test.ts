// CR-125 · cr125-form-step-card · bước «Điền thông tin» (form) của thẻ HĐ chiếu thành `kind: "form"` kèm trường + nhóm làm + task «Gửi»;
// các bước sau thấy giá trị đã gửi (chỉ đọc). Bước duyệt thường giữ nguyên (review, Duyệt/Trả lại/Từ chối).
import { describe, expect, test } from "bun:test";
import { FlowViewSchema } from "@ai/contracts/flow";
import { ContractApprovalSchema } from "@ai/contracts/pack-contracts";
import { flowViewOfCard } from "./approval-flow-view.rules";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FIELDS = [
  { key: "nha_cung_cap", type: "text", label: "Nhà cung cấp", max_len: 200, required: true },
  { key: "gia_bao", type: "money", label: "Giá báo", min: 0, required: false },
  { key: "tep_bao_gia", type: "file_ref", label: "Tệp báo giá", required: false },
];
const step = (idx: number, o: Record<string, unknown> = {}) => ({
  idx,
  key: `b${idx}`,
  name: `Bước ${idx}`,
  kind: "review",
  status: "pending",
  group_id: U(100 + idx),
  head_only: false,
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: null,
  decided_at: null,
  feedback: null,
  skip_when: null,
  ...o,
});
const card = (o: Record<string, unknown>) =>
  ContractApprovalSchema.parse({
    run_id: U(1),
    run_status: "waiting_review",
    step: "level1",
    task_id: null,
    can_act: false,
    feedback: null,
    block_reason: null,
    finalizes_on_approve: false,
    mode: "engine",
    from_run: true,
    needs_reopen: false,
    attention: null,
    esign: null,
    steps: [],
    ...o,
  });

describe("flowViewOfCard · bước form", () => {
  test("form đang mở, người xem thuộc nhóm làm ⇒ step form + task «Gửi» mang cả form (không Duyệt/Từ chối)", () => {
    const v = flowViewOfCard(
      card({
        task_id: U(9),
        can_act: true,
        steps: [step(0, { kind: "form", status: "open", form: { fields: FIELDS } })],
      }),
      U(5),
      3,
    );
    expect(FlowViewSchema.safeParse(v).success).toBe(true);
    const s = v.steps[0];
    expect(s?.kind).toBe("form");
    expect(s?.assignee).toEqual({ kind: "group", id: U(100), label: null, head_only: false });
    expect(s?.kind === "form" && s.form.fields.map((f) => f.key)).toEqual([
      "nha_cung_cap",
      "gia_bao",
      "tep_bao_gia",
    ]);
    expect(v.tasks).toHaveLength(1);
    const t = v.tasks[0];
    expect(t?.kind).toBe("form");
    expect(t?.step_key).toBe("b0");
    expect(t?.actions.map((a) => a.key)).toEqual(["submit"]);
    expect(t?.actions[0]?.input.kind).toBe("form");
  });
});

describe("flowViewOfCard · bước form đã gửi, người xem ngoài nhóm", () => {
  test("form đã gửi ⇒ giá trị chỉ đọc ở bước form; bước duyệt kế tiếp vẫn là review có Duyệt/Trả lại", () => {
    const values = { nha_cung_cap: "Công ty An Phát", gia_bao: 480000000, tep_bao_gia: U(77) };
    const v = flowViewOfCard(
      card({
        task_id: U(9),
        can_act: true,
        steps: [
          step(0, {
            kind: "form",
            status: "passed",
            form: { fields: FIELDS },
            values,
            decided_by: { id: U(5), name: "Mai" },
            decided_at: "2026-11-08T10:00:00.000Z",
          }),
          step(1, { status: "open" }),
        ],
      }),
      U(5),
      3,
    );
    const f = v.steps[0];
    expect(f?.kind === "form" && f.values).toEqual(values);
    expect(v.steps[1]?.kind).toBe("review");
    expect(v.tasks[0]?.kind).toBe("review");
    expect(v.tasks[0]?.actions.map((a) => a.key)).toEqual(["approve", "return", "redo", "reject"]);
  });

  test("người xem không thuộc nhóm làm (can_act=false) ⇒ thấy form mở nhưng không có task", () => {
    const v = flowViewOfCard(
      card({
        steps: [step(0, { kind: "form", status: "open", form: { fields: FIELDS } })],
      }),
      U(5),
      3,
    );
    expect(v.steps[0]?.kind).toBe("form");
    expect(v.tasks).toEqual([]);
  });
});
