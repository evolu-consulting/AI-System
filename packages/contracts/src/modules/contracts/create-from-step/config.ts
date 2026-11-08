// CR-125 · cr125-contract-from-step · cổng cấu hình + luật ánh xạ của node «Tạo hợp đồng từ hồ sơ» (MỘT nguồn: cũng là schema args tool
// `contracts-create-from-step`). Giá trị đơn (text/number) như node Ký số để panel chung dựng ô nhập; mỗi ô là nguồn «từ ô của bước trước»
// (`input_map` của stage). Chỉ zod + hàm thuần, không I/O (luật `contracts-only-zod`).
import { z } from "zod";

export const CREATE_FROM_STEP_TOOL = "contracts-create-from-step";
/** Mã lỗi nghiệp vụ (hiện ở thẻ «Cần xử lý» qua i18n `contracts.approval.engine.attention.reason.tool.<mã>`). */
export const CREATE_FROM_STEP_FILE_MISSING = "CONTRACT_STEP_FILE_MISSING";
export const CREATE_FROM_STEP_UPLOAD_FAILED = "CONTRACT_STEP_UPLOAD";
export const CREATE_FROM_STEP_STORAGE_OFF = "CONTRACT_STEP_STORAGE_OFF";

export const CREATE_FROM_STEP_TITLE_MAX = 200;
export const CREATE_FROM_STEP_TITLE_DEFAULT = "Hợp đồng từ hồ sơ";

export const CreateFromStepConfigSchema = z.object({
  /** Id tệp (ô «Đính kèm» của bước Soạn thảo). */
  file_id: z.string().optional().describe("Tệp hợp đồng"),
  title: z.string().max(CREATE_FROM_STEP_TITLE_MAX).optional().describe("Tên hợp đồng"),
  counterparty: z.string().max(CREATE_FROM_STEP_TITLE_MAX).optional().describe("Đối tác"),
  amount: z.coerce.number().min(0).optional().describe("Giá trị hợp đồng"),
});
export type CreateFromStepConfig = z.infer<typeof CreateFromStepConfigSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CreateFromStepPlan = {
  fileId: string;
  title: string;
  counterparty: string | null;
  /** Đồng (số nguyên) hoặc null khi không nhập. */
  amount: number | null;
};

/** Args của stage → kế hoạch tạo HĐ; không có tệp hợp lệ ⇒ `CONTRACT_STEP_FILE_MISSING` (không tạo gì). Thuần. */
export function planCreateFromStep(
  args: Record<string, unknown>,
): { ok: true; plan: CreateFromStepPlan } | { ok: false; code: string } {
  const p = CreateFromStepConfigSchema.safeParse(args);
  const c = p.success ? p.data : {};
  const fileId = (c.file_id ?? "").trim().toLowerCase();
  if (!UUID.test(fileId)) return { ok: false, code: CREATE_FROM_STEP_FILE_MISSING };
  const title = (c.title ?? "").trim().slice(0, CREATE_FROM_STEP_TITLE_MAX);
  const counterparty = (c.counterparty ?? "").trim();
  const amount =
    typeof c.amount === "number" && Number.isFinite(c.amount) && c.amount >= 0
      ? Math.round(c.amount)
      : null;
  return {
    ok: true,
    plan: {
      fileId,
      title: title === "" ? CREATE_FROM_STEP_TITLE_DEFAULT : title,
      counterparty: counterparty === "" ? null : counterparty,
      amount: amount !== null && Number.isSafeInteger(amount) ? amount : null,
    },
  };
}
