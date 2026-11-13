// CR-140 · node «Ghi thanh toán vào HĐ» (`contracts.record-payment`): bước chi tiền xong mà HĐ KHÔNG có đợt thanh toán ⇒ ghi MỘT dòng
// «đã trả» vào sổ thanh toán hiện có của HĐ (`contracts.obligations` kind=payment; MỘT nguồn, không bảng mới). Cổng cấu hình = schema args
// tool `contracts-record-payment`. HĐ lấy từ liên kết lượt↔HĐ của engine (args chỉ để đối chiếu). Chỉ zod + hàm thuần, không I/O
// (luật `contracts-only-zod`).
import { z } from "zod";

export const RECORD_PAYMENT_TOOL = "contracts-record-payment";
/** Mã lỗi nghiệp vụ (hiện ở thẻ «Cần xử lý» qua i18n `…attention.reason.tool.<mã>`). */
export const RECORD_PAYMENT_NO_RUN = "CONTRACT_PAYMENT_NO_RUN";
export const RECORD_PAYMENT_NO_CONTRACT = "CONTRACT_PAYMENT_NO_CONTRACT";
export const RECORD_PAYMENT_BAD_AMOUNT = "CONTRACT_PAYMENT_BAD_AMOUNT";
export const RECORD_PAYMENT_BAD_DATE = "CONTRACT_PAYMENT_BAD_DATE";
export const RECORD_PAYMENT_NO_ACTOR = "CONTRACT_PAYMENT_NO_ACTOR";
export const RECORD_PAYMENT_NOT_IN_STAGE = "CONTRACT_PAYMENT_NOT_IN_STAGE";
/** Trần số tiền một dòng (= cột `obligations.amount`). */
export const RECORD_PAYMENT_MAX = 1_000_000_000_000_000;

export const RecordPaymentConfigSchema = z.object({
  /** HĐ đối chiếu với HĐ gắn lượt (nguồn «từ bước trước» / đầu vào); lệch ⇒ lỗi. Vắng ⇒ lấy HĐ gắn lượt. */
  contract_id: z.string().optional().describe("Hợp đồng"),
  /** Số tiền đã chi (đồng, nguyên > 0); vắng ⇒ lấy giá trị HĐ. */
  amount: z.coerce
    .number()
    .int()
    .min(1)
    .max(RECORD_PAYMENT_MAX)
    .optional()
    .describe("Số tiền đã chi"),
  /** Ngày chi `YYYY-MM-DD` (bắt buộc khi ghi). */
  paid_at: z.string().optional().describe("Ngày chi"),
});
export type RecordPaymentConfig = z.infer<typeof RecordPaymentConfigSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

export type RecordPaymentPlan = {
  /** HĐ args chỉ định (đã chuẩn hoá) hoặc null nếu vắng — đối chiếu với HĐ gắn lượt ở tool. */
  contractId: string | null;
  /** Đồng (nguyên, 1…1e15) hoặc null ⇒ lấy giá trị HĐ (tool báo lỗi nếu HĐ cũng không có). */
  amount: number | null;
  /** `YYYY-MM-DD` hợp lệ theo lịch. */
  paidAt: string;
};

/** Ngày lịch hợp lệ `YYYY-MM-DD` (có thể kèm giờ ISO) ⇒ chuỗi ngày; sai ⇒ null. Thuần. */
export function isoDay(v: unknown): string | null {
  const m = ISO.exec(typeof v === "string" ? v.trim() : "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  const ok = t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  return ok ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Số tiền từ args: số nguyên (hoặc chuỗi chữ số) trong 1…1e15; rỗng/vắng ⇒ null (không ép "" thành 0); khác ⇒ `undefined` (lỗi). */
function amountOf(v: unknown): number | null | undefined {
  let n = v;
  if (n === undefined || n === null) return null;
  if (typeof n === "string") {
    const s = n.trim();
    if (s === "") return null;
    if (!/^\d{1,16}$/.test(s)) return undefined;
    n = Number(s);
  }
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > RECORD_PAYMENT_MAX)
    return undefined;
  return n;
}

/** Args của stage → kế hoạch ghi (thuần). Ngày sai/vắng ⇒ `BAD_DATE`; số tiền sai ⇒ `BAD_AMOUNT`; mã HĐ không phải uuid ⇒ `NO_CONTRACT`. */
export function planRecordPayment(
  args: Record<string, unknown>,
): { ok: true; plan: RecordPaymentPlan } | { ok: false; code: string } {
  const raw = typeof args.contract_id === "string" ? args.contract_id.trim().toLowerCase() : "";
  if (raw !== "" && !UUID.test(raw)) return { ok: false, code: RECORD_PAYMENT_NO_CONTRACT };
  const amount = amountOf(args.amount);
  if (amount === undefined) return { ok: false, code: RECORD_PAYMENT_BAD_AMOUNT };
  const paidAt = isoDay(args.paid_at);
  if (paidAt === null) return { ok: false, code: RECORD_PAYMENT_BAD_DATE };
  return { ok: true, plan: { contractId: raw === "" ? null : raw, amount, paidAt } };
}

/**
 * HĐ của khoản chi: `linked` = HĐ gắn với lượt/cây lượt (engine). Không có HĐ nào ⇒ `skip` (đơn mua nhỏ không có HĐ) — chỉ khi args cũng
 * không chỉ HĐ nào; args chỉ HĐ khác HĐ gắn lượt (hoặc lượt không có HĐ) ⇒ lỗi; nhiều HĐ trong cây ⇒ lỗi (không đoán). Thuần.
 */
export function pickContract(
  linked: readonly string[],
  argId: string | null,
): { kind: "skip" } | { kind: "use"; id: string } | { kind: "error"; code: string } {
  const ids = [...new Set(linked.map((x) => x.toLowerCase()))];
  if (ids.length > 1) return { kind: "error", code: RECORD_PAYMENT_NO_CONTRACT };
  const id = ids[0];
  if (id === undefined)
    return argId === null ? { kind: "skip" } : { kind: "error", code: RECORD_PAYMENT_NO_CONTRACT };
  if (argId !== null && argId !== id) return { kind: "error", code: RECORD_PAYMENT_NO_CONTRACT };
  return { kind: "use", id };
}
