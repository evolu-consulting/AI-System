// CR-125 · cr125-manual-start-engine · bắt đầu quy trình bằng phiếu yêu cầu: `GET /processes/startable` (flow người xem được bắt đầu,
// kèm phiếu) + `POST /processes/start` (khoá flow + giá trị phiếu + mã yêu cầu của client = khoá chống gửi trùng). Mã lỗi một nguồn.
import { z } from "zod";
import { UuidSchema } from "../common";
import {
  START_FORM_NODE_KEY,
  type StartFormConfig,
  StartFormConfigSchema,
} from "../modules/core/start-form/config";

/** Mã lỗi → HTTP status (i18n `process.run.startError.<mã>`; `check:error-codes`). */
export const PROCESS_START_ERRORS = {
  START_NOT_ALLOWED: 403,
  START_FORM_INVALID: 422,
  START_FLOW_OFF: 409,
} as const;
export type ProcessStartErrorCode = keyof typeof PROCESS_START_ERRORS;
export const PROCESS_START_ERROR_KEY = "process.run.startError";

export const StartProcessRequestSchema = z.strictObject({
  /** `process_defs.key` của flow công ty (bản công ty hoặc mẫu Thư viện được gán). */
  flow_key: z.string().min(1).max(64),
  /** Mã yêu cầu do client sinh mỗi lần mở phiếu — gửi lại cùng mã ⇒ cùng một lượt. */
  request_id: UuidSchema,
  values: z.record(z.string(), z.unknown()),
});
export type StartProcessRequest = z.infer<typeof StartProcessRequestSchema>;

export type StartProcessResponse = {
  run_id: string;
  /** false ⇒ mã yêu cầu đã dùng, trả lại lượt cũ. */
  created: boolean;
  title: string;
};

/** Chi tiết 422 `START_FORM_INVALID`: khoá ô → mã lỗi zod đầu tiên (`required`, `too_big`, `invalid_type`, `unrecognized`…). */
export type StartFormFieldErrors = { fields: Record<string, string> };

export type StartableFlow = {
  flow_key: string;
  name: string;
  company_flow_id: string;
  form: Pick<StartFormConfig, "fields" | "title_template">;
};
export type StartableResponse = { items: StartableFlow[] };

/** Đọc lại cấu hình từ jsonb stage (bản lưu cũ/hỏng ⇒ null: flow không bắt đầu bằng phiếu được). */
export function startFormOf(stage: unknown): StartFormConfig | null {
  const s = stage as { node?: unknown; start_form?: unknown } | null | undefined;
  if (s?.node !== START_FORM_NODE_KEY) return null;
  const p = StartFormConfigSchema.safeParse(s.start_form);
  return p.success ? p.data : null;
}
