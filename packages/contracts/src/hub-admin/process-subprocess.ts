// CR-125 · node «Quy trình con» (`core.subprocess`, executor `subprocess`): bước chạy MỘT lượt của quy trình khác (công ty / Thư viện,
// cùng công ty) rồi chờ lượt con kết thúc. Lượt con xong ⇒ output bước có `outcome` (done | rejected | cancelled) + dữ liệu cuối của lượt
// con dưới khoá `sub_<trường>`; rẽ theo `branches[].on` (= khoá đầu ra của node) như `wait_event`. Chỉ dữ liệu + zod.
import { z } from "zod";
import { ProcessKeySchema } from "../chat/processes";
import { InputKeySchema } from "./sources";

/** Lồng tối đa: quy trình → con → cháu → chắt (3 cạnh «Quy trình con»). */
export const SUBPROCESS_DEPTH_MAX = 3;
/** Kết quả lượt con = khoá đầu ra của node (đường `done` = đi tiếp bước kế). */
export const SUBPROCESS_OUTCOMES = ["done", "rejected", "cancelled"] as const;
export type SubprocessOutcome = (typeof SUBPROCESS_OUTCOMES)[number];
/** Field output của bước: kết quả lượt con (để rẽ / node Nếu đọc). */
export const SUBPROCESS_OUTCOME_FIELD = "outcome";
/** Tiền tố khoá dữ liệu lượt con trong output bước cha (`sub_amount`…) — hợp `FIELD_KEY_RE` để bước sau / Nếu đọc được. */
export const SUBPROCESS_FIELD_PREFIX = "sub_";
/**
 * Nguồn dữ liệu cha = id nguồn của `autoMapInputs`/`mapSourcesAt`: `<khoá>` (đầu ra «Bắt đầu khi» = đầu vào lượt) hoặc `<mã bước>:<trường>`
 * (đầu ra bước trước).
 */
export const SUBPROCESS_PATH_RE = /^([a-z0-9_-]{1,40}:)?[a-z0-9_-]{1,32}$/;
export const SUBPROCESS_INPUT_MAP_MAX = 20;

export const SubprocessExecutorSchema = z.strictObject({
  kind: z.literal("subprocess"),
  /** Khoá quy trình con (công ty hoặc Thư viện, cùng công ty), đã xuất bản. */
  def_key: ProcessKeySchema,
  /** Đầu vào lượt con ← đường dữ liệu của lượt cha. */
  input_map: z
    .record(InputKeySchema, z.string().regex(SUBPROCESS_PATH_RE))
    .refine((m) => Object.keys(m).length <= SUBPROCESS_INPUT_MAP_MAX)
    .optional(),
  /** Rẽ theo kết quả lượt con (`on` = rejected | cancelled ⇒ bước `goto_step`); vắng ⇒ bước kế. */
  branches: z
    .array(
      z.strictObject({
        on: z.enum(SUBPROCESS_OUTCOMES),
        goto_step: z.number().int().min(0).max(255),
      }),
    )
    .max(SUBPROCESS_OUTCOMES.length)
    .optional(),
});
export type SubprocessExecutor = z.infer<typeof SubprocessExecutorSchema>;

/** Lỗi lưu def (422, `details.path` = `stages.<i>.executor.def_key`, `details.def_key`). Web dịch `process.admin.apiError.<MÃ>`. */
export const HUB_ADMIN_SUBPROCESS_ERRORS = {
  /** Quy trình con không có / chưa xuất bản / khác công ty. */
  SUBPROCESS_NOT_FOUND: 422,
  /** Gọi vòng (A → B → A). */
  SUBPROCESS_CYCLE: 422,
  /** Lồng quá `SUBPROCESS_DEPTH_MAX`. */
  SUBPROCESS_DEPTH: 422,
} as const;
export type HubAdminSubprocessErrorCode = keyof typeof HUB_ADMIN_SUBPROCESS_ERRORS;
