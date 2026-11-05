// CR-121 D-0 · ranh giới điều kiện bước: `FlowCond`/`FlowWhen` mở rộng (phòng ban người tạo, đối tác mới, nhóm lồng một cấp) mà
// def/run cũ (`deal` + `total_value`, một cấp) vẫn parse ra ĐÚNG như cũ; trần bước người dùng khớp trần stage engine.
import { describe, expect, it } from "bun:test";
import { PROCESS_STAGES_MAX } from "../chat/processes";
import {
  APPROVAL_FLOW_CONDS_MAX,
  APPROVAL_FLOW_STEPS_MAX,
  APPROVAL_FLOW_SYSTEM_STAGES,
  FLOW_COND_FIELDS,
  FlowStepsSchema,
  FlowWhenSchema,
  flowLeafConds,
  isFlowCondGroup,
} from "./approval-flow";

const OLD_WHENS = [
  { op: "and", conds: [{ field: "total_value", op: "ge", value: 500_000_000 }] },
  { op: "and", conds: [{ field: "deal", in: ["buy", "sell"] }] },
  {
    op: "or",
    conds: [
      { field: "total_value", op: "ge", value: 1_000_000_000 },
      { field: "deal", in: ["buy"] },
    ],
  },
];

const review = (key: string, when: unknown = null) => ({
  kind: "review",
  key,
  name: key,
  department_group_id: "00000000-0000-4000-8000-000000000001",
  head_only: false,
  due_h: 48,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when,
});

describe("CR-121 D-0 · FlowWhen tương thích ngược", () => {
  it("điều kiện cũ (loại HĐ / giá trị, một cấp) parse ra y nguyên", () => {
    for (const w of OLD_WHENS) expect(FlowWhenSchema.parse(w)).toEqual(w as never);
    const steps = [review("a"), review("b", OLD_WHENS[0]), review("c", OLD_WHENS[2])];
    expect(FlowStepsSchema.parse(steps)).toEqual(steps as never);
  });

  it("trường mới + nhóm lồng một cấp parse được", () => {
    const w = {
      op: "and",
      conds: [
        { field: "creator_department", in: ["sales", "sales-hn"] },
        {
          op: "or",
          conds: [
            { field: "new_partner", is: true },
            { field: "total_value", op: "gt", value: 600_000_000 },
          ],
        },
      ],
    };
    const p = FlowWhenSchema.parse(w);
    expect(p).toEqual(w as never);
    expect(p.conds.map(isFlowCondGroup)).toEqual([false, true]);
    expect(flowLeafConds(p).map((c) => c.field)).toEqual([
      "creator_department",
      "new_partner",
      "total_value",
    ]);
  });

  it("chặn: lồng hai cấp, trường lạ, mã phòng sai dạng, quá số điều kiện", () => {
    const leaf = { field: "new_partner", is: false };
    const deep = { op: "and", conds: [{ op: "or", conds: [{ op: "and", conds: [leaf] }] }] };
    expect(FlowWhenSchema.safeParse(deep).success).toBe(false);
    expect(
      FlowWhenSchema.safeParse({ op: "and", conds: [{ field: "payment_due", op: "ge", value: 1 }] })
        .success,
    ).toBe(false);
    expect(
      FlowWhenSchema.safeParse({
        op: "and",
        conds: [{ field: "creator_department", in: ["Phòng KD"] }],
      }).success,
    ).toBe(false);
    const many = Array.from({ length: APPROVAL_FLOW_CONDS_MAX + 1 }, () => leaf);
    expect(FlowWhenSchema.safeParse({ op: "or", conds: many }).success).toBe(false);
  });

  it("danh sách trường điều kiện v1 của gói hợp đồng", () => {
    expect([...FLOW_COND_FIELDS]).toEqual([
      "deal",
      "total_value",
      "creator_department",
      "new_partner",
    ]);
  });
});

describe("CR-121 D-0 · trần số bước", () => {
  it("bước người dùng + route + finalize ≤ trần stage engine, vượt trần ⇒ schema chặn", () => {
    expect(APPROVAL_FLOW_STEPS_MAX + APPROVAL_FLOW_SYSTEM_STAGES).toBeLessThanOrEqual(
      PROCESS_STAGES_MAX,
    );
    const steps = (n: number) => Array.from({ length: n }, (_, i) => review(`s${i}`));
    expect(FlowStepsSchema.safeParse(steps(APPROVAL_FLOW_STEPS_MAX)).success).toBe(true);
    expect(FlowStepsSchema.safeParse(steps(APPROVAL_FLOW_STEPS_MAX + 1)).success).toBe(false);
  });
});
