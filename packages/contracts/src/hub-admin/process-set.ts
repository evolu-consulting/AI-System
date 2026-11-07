// CR-103 · R4 fnr-showcase: schema node `set` (họ `work`, không AI) — ghi field output từ input run / hằng.
// Chỉ schema + kiểu; CHƯA vào `executor` union của `ProcessStageDefSchema` (nối dây ở phase B sau khi R1 gộp).
// Không import `./processes` (file đó sẽ import file này) ⇒ không vòng import.
import { z } from "zod";
import { FACT_KEY_RE } from "../app-manifest/manifest";
import { PROCESS_INPUT_MAX, ProcessStepSchema } from "../chat/processes";
import { FIELD_KEY_RE } from "./process-tools";
import { InputKeySchema } from "./sources";

/** Key của flow mẫu (seed `tools/scripts/src/seed-flow-showcase.ts`; trang `/processes/showcase` tìm def theo key này). */
export const FLOW_SHOWCASE_KEY = "flow-showcase";

/** Trần số dòng gán của một node `set`. */
export const SET_VALUES_MAX = 20;

/**
 * Nguồn giá trị của một dòng gán: input của run (theo key) · hằng · CR-122 E4: field output của một BƯỚC TRƯỚC (`step` < bước của
 * `set`, khoá có trong output bước đó) · dữ kiện HIỆN TẠI của bản ghi (`fact`, đọc qua `FactsReader` như node Nếu).
 */
export const SetFromSchema = z.union([
  z.strictObject({ input: InputKeySchema }),
  z.strictObject({ const: z.union([z.string().max(PROCESS_INPUT_MAX), z.number()]) }),
  z.strictObject({
    kind: z.literal("field"),
    step: ProcessStepSchema,
    key: z.string().regex(FIELD_KEY_RE),
  }),
  z.strictObject({ kind: z.literal("fact"), key: z.string().regex(FACT_KEY_RE) }),
]);
export type SetFrom = z.infer<typeof SetFromSchema>;

/** CR-122 E4 · biến đổi kiểu tối thiểu khi ghi: số · chữ · ngày ISO (`YYYY-MM-DD`) · đúng/sai (ghi "true"/"false"). Sai dạng ⇒ null. */
export const SET_AS = ["number", "text", "date", "bool"] as const;
export type SetAs = (typeof SET_AS)[number];

export const SetValueSchema = z.strictObject({
  /** Key field output của stage (phải khai báo trong `output.fields`, luật `setDefIssues`). */
  key: z.string().regex(FIELD_KEY_RE),
  from: SetFromSchema,
  as: z.enum(SET_AS).optional(),
});
export type SetValue = z.infer<typeof SetValueSchema>;

export const SetExecutorSchema = z.strictObject({
  kind: z.literal("set"),
  values: z.array(SetValueSchema).max(SET_VALUES_MAX),
});
export type SetExecutor = z.infer<typeof SetExecutorSchema>;
