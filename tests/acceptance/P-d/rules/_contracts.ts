// HUB-FR-143…145 · AC-H41 · AC-H42 · AC-H43 · P-d1 (test-plan §5 PD-C01…C08, addendum §2 PD-C15): dữ liệu mẫu cố định +
// tra schema/hàm contract qua module lỏng (export vắng ⇒ đỏ ở `expect`, không vỡ typecheck). Không DB/env. Dải id `d1c0…`.
import { expect } from "bun:test";
import type { Loose } from "../_support/modules";

// biome-ignore lint/suspicious/noExplicitAny: schema zod nạp động, chưa có kiểu khi viết test
type AnySchema = any;
type Rec = Record<string, unknown>;

export const X = (n: number) => `d1c00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const G_DUYET = X(1); // Group duyệt
export const G_CAP = X(2); // Group nhận chuyển cấp
export const AG = X(11);
export const TS = "2026-10-18T02:00:00.000Z";

/** Schema `name` của module contract; vắng ⇒ đỏ ở expect (đúng lý do: export chưa có). */
export function schemaOf(m: Loose, name: string): AnySchema {
  const s = m[name];
  expect({ [name]: typeof s?.safeParse }).toEqual({ [name]: "function" });
  return s;
}
export const ok = (s: AnySchema, v: unknown): boolean => s.safeParse(v).success === true;
/** `field` của strictObject (`.shape`); vắng ⇒ đỏ ở expect. */
export function fieldOf(s: AnySchema, field: string): AnySchema {
  const f = s?.shape?.[field];
  expect({ [field]: typeof f?.safeParse }).toEqual({ [field]: "function" });
  return f;
}

/** Stage agent đầy đủ (zod `ProcessStageDefSchema`); `o` ghi đè. */
export function agentDef(o: Rec = {}): Rec {
  return {
    key: "doc",
    name: "Đọc hoá đơn",
    executor: { kind: "agent", agent_id: AG },
    instruction: "Đọc hoá đơn, trích ngày hợp đồng.",
    output: {
      filename: "doc.md",
      template: "## Kết quả\n",
      required_sections: ["Kết quả"],
      fields: [{ key: "ngay_hd", type: "date", required: true }],
    },
    after: { kind: "review", group_id: G_DUYET },
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: 600,
    token_budget: null,
    sources: [],
    must_know: [],
    ...o,
  };
}

export const WAIT_EXEC = (o: Rec = {}): Rec => ({
  kind: "wait_until",
  from: { kind: "input", key: "ngay-ky" },
  offset_days: 3,
  ...o,
});

/** Stage `wait_until` đầy đủ (zod); `o` ghi đè. */
export function waitDef(o: Rec = {}): Rec {
  return {
    key: "cho",
    name: "Chờ tới ngày",
    executor: WAIT_EXEC(),
    instruction: "",
    output: {
      filename: "cho.md",
      template: "# Chờ tới ngày\n\n## Bàn giao\n",
      required_sections: ["Bàn giao"],
      fields: [],
    },
    after: { kind: "auto" },
    real_action: false,
    answerer: { kind: "starter" },
    token_budget: null,
    ...o,
  };
}

/** Body `ProcessDefInputSchema` tối thiểu (1 stage agent); `o` ghi đè. */
export function defInput(o: Rec = {}): Rec {
  return {
    key: "hd-cho",
    name: "Hợp đồng chờ ngày",
    description: "",
    input_hint: "",
    run_group_ids: [],
    stages: [agentDef()],
    token_budget: null,
    enabled: true,
    ...o,
  };
}

/** Bản nháp stage (snake_case, hình `processDefStageIssues`) — stage `wait_until` hợp lệ; `o` ghi đè. */
export function waitDraft(o: Rec = {}): Rec {
  return {
    key: "cho",
    real_action: false,
    executor: {
      kind: "wait_until",
      from: { kind: "input", key: "ngay-ky" },
      offset_days: 3,
      time: "09:00",
    },
    after: { kind: "auto" },
    sources: [],
    must_know: [],
    autofix: null,
    output: { fields: [] },
    ...o,
  };
}

/** Bản nháp stage agent (review Group duyệt, có trường `ngay_hd: date`); `o` ghi đè. */
export function agentDraft(o: Rec = {}): Rec {
  return {
    key: "doc",
    real_action: false,
    executor: { kind: "agent", agent_id: AG },
    after: { kind: "review", group_id: G_DUYET, back_to_steps: [] },
    sources: [],
    must_know: [],
    autofix: null,
    output: { fields: [{ key: "ngay_hd", type: "date", required: true }] },
    ...o,
  };
}

/** Input khai báo của def (bản nháp FE): `ngay-ky` kiểu date, `ghi-chu` kiểu text. */
export const DRAFT_INPUTS = [
  { key: "ngay-ky", type: "date" },
  { key: "ghi-chu", type: "text" },
] as const;
