// CR-122 · ADR-0038 · FLOW2-FR-10/12 · node Bắt đầu khi (`trigger {event, when?}`) + điều kiện trên dữ kiện. File LÁ (không import
// `./processes`/`./process-library`) ⇒ `process-library` (trường def) và `process-flowdef` cùng dùng mà không vòng import.
import { z } from "zod";
import { FACT_KEY_RE, FLOW_EVENT_KEY_RE } from "../app-manifest/manifest";
import { IF_CONDS_MAX, IF_CONDS_MIN, IF_VALUE_MAX } from "./process-if";

/** So sánh dữ kiện: như `BRANCH_OPS` + `in` (thuộc danh sách, cho `enum`/`department`). */
export const FACT_OPS = ["eq", "ne", "lt", "le", "gt", "ge", "in"] as const;
export type FactOp = (typeof FACT_OPS)[number];
export const FACT_IN_MAX = 50;

export const FactCondSchema = z.strictObject({
  fact: z.string().regex(FACT_KEY_RE),
  op: z.enum(FACT_OPS),
  value: z.union([
    z.string().max(IF_VALUE_MAX),
    z.number(),
    z.boolean(),
    z.array(z.string().max(IF_VALUE_MAX)).min(1).max(FACT_IN_MAX),
  ]),
});
export type FactCond = z.infer<typeof FactCondSchema>;
const WhenOp = z.enum(["and", "or"]);
export const FactCondGroupSchema = z.strictObject({
  op: WhenOp,
  conds: z.array(FactCondSchema).min(IF_CONDS_MIN).max(IF_CONDS_MAX),
});
/** AND/OR lồng MỘT cấp, ≤ 6 vế mỗi cấp (FLOW2-FR-12) — cùng control dựng điều kiện cho Bắt đầu khi và Nếu (FR-16). */
export const FactWhenSchema = z.strictObject({
  op: WhenOp,
  conds: z
    .array(z.union([FactCondSchema, FactCondGroupSchema]))
    .min(IF_CONDS_MIN)
    .max(IF_CONDS_MAX),
});
export type FactWhen = z.infer<typeof FactWhenSchema>;

/** Node Bắt đầu khi: sự kiện trong `AppManifest.events` + điều kiện tuỳ chọn trên dữ kiện lúc sự kiện. */
export const FlowTriggerSchema = z.strictObject({
  event: z.string().regex(FLOW_EVENT_KEY_RE),
  when: FactWhenSchema.optional(),
});
export type FlowTrigger = z.infer<typeof FlowTriggerSchema>;
