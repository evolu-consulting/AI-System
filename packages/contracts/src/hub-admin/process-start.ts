// CR-125 · cr125-manual-start-engine · bắt đầu quy trình bằng phiếu yêu cầu: `GET /processes/startable` (flow người xem được bắt đầu,
// kèm phiếu) + `POST /processes/start` (khoá flow + giá trị phiếu + mã yêu cầu của client = khoá chống gửi trùng). Mã lỗi một nguồn.
import { z } from "zod";
import type { ProcessRunView } from "../chat/processes-entities";
import { UuidSchema } from "../common";
import type { FlowView } from "../flow";
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
  /** Lưới an toàn: sự kiện của khoá chống trùng không phải của người gọi / mã này (không trả lượt của người khác). */
  START_REQUEST_REUSED: 409,
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
  /** Mô tả quy trình (rỗng ⇒ trang không hiện dòng mô tả). */
  description: string;
  form: Pick<StartFormConfig, "fields" | "title_template">;
};
export type StartableResponse = { items: StartableFlow[] };

/** CR-126 · `GET /processes/requests/mine`: nhóm trạng thái một chữ của yêu cầu mình đã gửi. */
export const MY_REQUEST_WORDS = ["waiting", "done", "returned", "rejected"] as const;
export type MyRequestWord = (typeof MY_REQUEST_WORDS)[number];
export type MyRequestItem = {
  run_id: string;
  title: string;
  created_at: string;
  word: MyRequestWord;
  /** Tên người/nhóm đang chờ (chỉ khi `word = waiting`); null ⇒ chưa rõ. */
  waiting_for: string | null;
};
export type MyRequestsResponse = { items: MyRequestItem[] };

/** Đọc lại cấu hình từ jsonb stage (bản lưu cũ/hỏng ⇒ null: flow không bắt đầu bằng phiếu được). */
export function startFormOf(stage: unknown): StartFormConfig | null {
  const s = stage as { node?: unknown; start_form?: unknown } | null | undefined;
  if (s?.node !== START_FORM_NODE_KEY) return null;
  const p = StartFormConfigSchema.safeParse(s.start_form);
  return p.success ? p.data : null;
}

/** `GET /processes/requests/:run_id`: trang «yêu cầu» — lượt (quyền xem như `GET /process-runs/:id`) + giá trị phiếu đã điền. */
export type StartRequestView = {
  run: ProcessRunView;
  title: string;
  fields: { key: string; label: string; type: string; value: string }[];
  /** CR-125 · request-steps · các bước của lượt + lượt con lồng nhau (cùng `FlowView` với thẻ HĐ). */
  steps: RequestStepNode;
  /** Lượt gốc khi lượt này là lượt con VÀ người xem xem được lượt gốc; ngược lại null (trang inbox mở trang của lượt gốc). */
  root_run_id: string | null;
};

/** Một lượt trong cây yêu cầu: bước (FlowView) + lượt con (Quy trình con) theo thứ tự bắt đầu. */
export type RequestStepNode = {
  run_id: string;
  name: string;
  status: string;
  /** Vị trí bước của lượt cha mà lượt con này chạy (null ở lượt gốc của trang). */
  parent_stage_idx: number | null;
  /** Đích «Trả lại» của bước đang mở (stage có `back_to_steps`); null ⇒ nhánh Trả lại do chính bước quyết. */
  back_to_step: number | null;
  flow: FlowView;
  children: RequestStepNode[];
};
