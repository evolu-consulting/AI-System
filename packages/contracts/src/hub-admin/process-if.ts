// CR-103 · fnr-if (flow-node-registry design §3): node `if` — điều kiện AND/OR trên field output của stage bước trước hoặc input
// của run, rẽ Đúng/Sai theo bước. Chỉ khai báo kiểu (đợt này chưa đưa vào union `executor` của `./processes` — đợt wiring làm).
// Không import `./processes` (file đó sẽ import file này) ⇒ không vòng import lúc chạy.
import { z } from "zod";
import { BRANCH_OPS, ProcessStepSchema, STAGE_KEY_RE } from "../chat/processes";
import { FIELD_KEY_RE } from "./process-tools";
import { SourceKeySchema } from "./sources";

/** Số điều kiện tối thiểu / tối đa của một node If. */
export const IF_CONDS_MIN = 1;
export const IF_CONDS_MAX = 6;
/** Độ dài tối đa giá trị so sánh dạng chuỗi (= `BranchRuleSchema.value`). */
export const IF_VALUE_MAX = 200;

export const CondFromSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("field"),
    stage_key: z.string().regex(STAGE_KEY_RE),
    field: z.string().regex(FIELD_KEY_RE),
  }),
  z.strictObject({ kind: z.literal("input"), key: SourceKeySchema }),
]);
export type CondFrom = z.infer<typeof CondFromSchema>;

export const CondSchema = z.strictObject({
  from: CondFromSchema,
  op: z.enum(BRANCH_OPS),
  value: z.union([z.string().max(IF_VALUE_MAX), z.number()]),
});
export type Cond = z.infer<typeof CondSchema>;

export const WhenSchema = z.strictObject({
  op: z.enum(["and", "or"]),
  conds: z.array(CondSchema).min(IF_CONDS_MIN).max(IF_CONDS_MAX),
});
export type When = z.infer<typeof WhenSchema>;

/** `then_step`/`else_step` 0-based (như `goto_step`); `else_step = null` ⇒ Sai thì sang bước kế. */
export const IfExecutorSchema = z.strictObject({
  kind: z.literal("if"),
  when: WhenSchema,
  then_step: ProcessStepSchema,
  else_step: ProcessStepSchema.nullable(),
});
export type IfExecutor = z.infer<typeof IfExecutorSchema>;
