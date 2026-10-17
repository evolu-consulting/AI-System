// Helper (không chứa `it`) cho rules/{wait-def,escalate-def}.test.ts: dựng `StageShape`/`InputShape` tự khai theo
// plan-domain §1 (`P/domain/defs/def-shape.ts`, `domain/types.ts`) — test KHÔNG import kiểu sản phẩm chưa có.

export const G1 = "a5d00000-0000-4000-8000-0000000000a1"; // Group duyệt (Kế toán)
export const G2 = "a5d00000-0000-4000-8000-0000000000a2"; // Group chuyển cấp (Giám đốc)

export type WaitFrom =
  | { kind: "input"; key: string }
  | { kind: "field"; stageKey: string; field: string };
export type FieldShape = { key: string; type: "number" | "string" | "date"; required: boolean };
export type StageShape = {
  key: string;
  step: number;
  realAction: boolean;
  after: "review" | "auto";
  reviewGroupId: string | null;
  executorKind: "agent" | "team" | "apply" | "wait_until";
  hasSources: boolean;
  hasMustKnow: boolean;
  hasAutofix: boolean;
  wait: { from: WaitFrom; offsetDays: number; time: string } | null;
  fields: readonly FieldShape[];
  remindEveryH: number | null;
  escalate: { afterH: number; groupId: string } | null;
};
export type InputShape = { key: string; type: "text" | "select" | "file" | "source_ref" | "date" };

/** Stage agent `after:"auto"` mặc định; ghi đè từng trường. */
export const st = (o: Partial<StageShape> & { key: string; step: number }): StageShape => ({
  realAction: false,
  after: "auto",
  reviewGroupId: null,
  executorKind: "agent",
  hasSources: false,
  hasMustKnow: false,
  hasAutofix: false,
  wait: null,
  fields: [],
  remindEveryH: null,
  escalate: null,
  ...o,
});

/** Stage `wait_until` hợp lệ (after auto) — mặc định lấy từ field `doc.ngay_het_han`, −3 ngày, 09:00. */
export const waitSt = (
  o: Partial<StageShape> & { key: string; step: number },
  w: Partial<NonNullable<StageShape["wait"]>> = {},
): StageShape =>
  st({
    executorKind: "wait_until",
    wait: {
      from: { kind: "field", stageKey: "doc", field: "ngay_het_han" },
      offsetDays: -3,
      time: "09:00",
      ...w,
    },
    ...o,
  });

export const fieldFrom = (stageKey: string, field: string): WaitFrom => ({
  kind: "field",
  stageKey,
  field,
});
export const inputFrom = (key: string): WaitFrom => ({ kind: "input", key });

export const INPUTS: readonly InputShape[] = [
  { key: "han", type: "date" },
  { key: "ghi_chu", type: "text" },
];
