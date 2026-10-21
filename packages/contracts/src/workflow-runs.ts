// dify-workflows · contract GET /admin/workflows/:id/runs — lịch sử chạy Dify của một workflow (platform_admin).
// Dữ liệu từ `hub.dify_runs` (Hub ghi mỗi lời gọi Dify: lệnh / agent / tool). Không chứa app-key hay inputs.
import { z } from "zod";
import { CountSchema, IsoDateTime, UuidSchema } from "./common";
import { DateOnlySchema } from "./quotas";

export const DIFY_RUN_TRIGGERS = ["command", "agent", "schedule"] as const;
export const DIFY_RUN_STATUSES = ["ok", "failed", "aborted"] as const;
export const DifyRunTriggerSchema = z.enum(DIFY_RUN_TRIGGERS);
export const DifyRunStatusSchema = z.enum(DIFY_RUN_STATUSES);
export type DifyRunTrigger = z.infer<typeof DifyRunTriggerSchema>;
export type DifyRunStatus = z.infer<typeof DifyRunStatusSchema>;

export const DIFY_RUNS_LIMIT_DEFAULT = 20;
export const DIFY_RUNS_LIMIT_MAX = 100;
export const DIFY_RUNS_OFFSET_MAX = 100_000;

/** `from`/`to` = ngày VN (`YYYY-MM-DD`) như trang usage; `to` gồm cả ngày đó. */
export const DifyRunsQuerySchema = z
  .strictObject({
    tenant_id: UuidSchema.optional(),
    status: DifyRunStatusSchema.optional(),
    from: DateOnlySchema.optional(),
    to: DateOnlySchema.optional(),
    limit: z.coerce.number().int().min(1).max(DIFY_RUNS_LIMIT_MAX).default(DIFY_RUNS_LIMIT_DEFAULT),
    offset: z.coerce.number().int().min(0).max(DIFY_RUNS_OFFSET_MAX).default(0),
  })
  .refine((q) => !(q.from && q.to) || q.from <= q.to, {
    message: "from must be <= to",
    path: ["from"],
  });
export type DifyRunsQuery = z.infer<typeof DifyRunsQuerySchema>;

export const DifyRunSchema = z.strictObject({
  id: UuidSchema,
  at: IsoDateTime,
  tenant: z.strictObject({ id: UuidSchema, name: z.string() }),
  user: z.strictObject({ id: UuidSchema, name: z.string() }).nullable(),
  trigger: DifyRunTriggerSchema,
  status: DifyRunStatusSchema,
  duration_ms: CountSchema,
  tokens: CountSchema,
  error_message: z.string().nullable(),
  dify_workflow_run_id: z.string().nullable(),
  dify_conversation_id: z.string().nullable(),
  /** Link log của app trong Dify console; null khi chưa cấu hình DIFY_CONSOLE_URL / thiếu mã app. */
  dify_url: z.string().nullable(),
});
export type DifyRun = z.infer<typeof DifyRunSchema>;

export const DifyRunsResponseSchema = z.strictObject({
  items: z.array(DifyRunSchema),
  total: CountSchema,
  /** false khi DB chưa có `hub.dify_runs` đọc được (Hub chưa migrate) ⇒ items rỗng. */
  available: z.boolean(),
});
export type DifyRunsResponse = z.infer<typeof DifyRunsResponseSchema>;
