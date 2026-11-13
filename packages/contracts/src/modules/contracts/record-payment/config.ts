// CR-140 · node «Ghi thanh toán vào HĐ» (`contracts.record-payment`): bước chi tiền xong mà HĐ KHÔNG có đợt thanh toán ⇒ ghi MỘT dòng
// «đã trả» vào sổ thanh toán hiện có của HĐ (`contracts.obligations` kind=payment; MỘT nguồn, không bảng mới). Cổng cấu hình = schema args
// tool `contracts-record-payment`. Chỉ zod + hàm thuần, không I/O (luật `contracts-only-zod`).
import { z } from "zod";

export const RECORD_PAYMENT_TOOL = "contracts-record-payment";
/** Mã lỗi nghiệp vụ (hiện ở thẻ «Cần xử lý»). */
export const RECORD_PAYMENT_NO_RUN = "CONTRACT_PAYMENT_NO_RUN";
export const RECORD_PAYMENT_NO_CONTRACT = "CONTRACT_PAYMENT_NO_CONTRACT";
export const RECORD_PAYMENT_BAD_AMOUNT = "CONTRACT_PAYMENT_BAD_AMOUNT";

export const RecordPaymentConfigSchema = z.object({
  /** HĐ cần ghi (nguồn «từ bước trước» / đầu vào); vắng ⇒ bỏ qua (đơn mua nhỏ không có HĐ). */
  contract_id: z.string().optional().describe("Hợp đồng"),
  /** Số tiền đã chi (đồng); vắng ⇒ lấy giá trị HĐ. */
  amount: z.coerce.number().min(0).optional().describe("Số tiền đã chi"),
  /** Ngày chi `YYYY-MM-DD`; vắng ⇒ hôm nay theo múi giờ công ty. */
  paid_at: z.string().optional().describe("Ngày chi"),
});
export type RecordPaymentConfig = z.infer<typeof RecordPaymentConfigSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

export type RecordPaymentPlan = {
  contractId: string;
  /** Đồng (số nguyên) hoặc null ⇒ lấy giá trị HĐ. */
  amount: number | null;
  /** `YYYY-MM-DD` hoặc null ⇒ hôm nay. */
  paidAt: string | null;
};

/** Args của stage → kế hoạch ghi. Không có HĐ ⇒ `{ ok: true, plan: null }` (bỏ qua, không lỗi); số tiền sai ⇒ lỗi. Thuần. */
export function planRecordPayment(
  args: Record<string, unknown>,
): { ok: true; plan: RecordPaymentPlan | null } | { ok: false; code: string } {
  const p = RecordPaymentConfigSchema.safeParse(args);
  if (!p.success) return { ok: false, code: RECORD_PAYMENT_BAD_AMOUNT };
  const id = (p.data.contract_id ?? "").trim().toLowerCase();
  if (id === "") return { ok: true, plan: null };
  if (!UUID.test(id)) return { ok: false, code: RECORD_PAYMENT_NO_CONTRACT };
  const a = p.data.amount;
  const amount = typeof a === "number" && Number.isFinite(a) ? Math.round(a) : null;
  if (amount !== null && !(amount >= 0 && amount <= 1_000_000_000_000_000))
    return { ok: false, code: RECORD_PAYMENT_BAD_AMOUNT };
  const m = ISO.exec((p.data.paid_at ?? "").trim());
  const paidAt = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  return { ok: true, plan: { contractId: id, amount, paidAt } };
}
