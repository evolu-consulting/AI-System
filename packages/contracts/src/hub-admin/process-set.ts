// CR-103 · R4 fnr-showcase: schema node `set` (họ `work`, không AI) — ghi field output từ input run / hằng.
// Chỉ schema + kiểu; CHƯA vào `executor` union của `ProcessStageDefSchema` (nối dây ở phase B sau khi R1 gộp).
// Không import `./processes` (file đó sẽ import file này) ⇒ không vòng import.
import { z } from "zod";
import { PROCESS_INPUT_MAX } from "../chat/processes";
import { FIELD_KEY_RE } from "./process-tools";
import { SourceKeySchema } from "./sources";

/** Key của flow mẫu (seed `tools/scripts/src/seed-flow-showcase.ts`; trang `/processes/showcase` tìm def theo key này). */
export const FLOW_SHOWCASE_KEY = "flow-showcase";

/** Trần số dòng gán của một node `set`. */
export const SET_VALUES_MAX = 20;

/** Nguồn giá trị của một dòng gán: input của run (theo key) hoặc hằng. */
export const SetFromSchema = z.union([
  z.strictObject({ input: SourceKeySchema }),
  z.strictObject({ const: z.union([z.string().max(PROCESS_INPUT_MAX), z.number()]) }),
]);
export type SetFrom = z.infer<typeof SetFromSchema>;

export const SetValueSchema = z.strictObject({
  /** Key field output của stage (phải khai báo trong `output.fields`, luật `setDefIssues`). */
  key: z.string().regex(FIELD_KEY_RE),
  from: SetFromSchema,
});
export type SetValue = z.infer<typeof SetValueSchema>;

export const SetExecutorSchema = z.strictObject({
  kind: z.literal("set"),
  values: z.array(SetValueSchema).max(SET_VALUES_MAX),
});
export type SetExecutor = z.infer<typeof SetExecutorSchema>;
