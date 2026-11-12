// CR-135 Q3 (thay CR-122 p12): số chứng từ giữ NGUYÊN VĂN người nhập / AI đọc ra — cho "/", chữ có dấu, khoảng trắng giữa.
// Chỉ: cắt khoảng trắng 2 đầu, NFC, ≤ 50 ký tự, không có ký tự điều khiển/xuống dòng.
import { z } from "zod";

export const DOC_NUMBER_MAX = 50;
/** Ký tự điều khiển (kể cả xuống dòng, tab) và dấu ngắt dòng/đoạn Unicode. */
export const DOC_NUMBER_CONTROL_RE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
export const DOC_NUMBER_MESSAGE = "Số hợp đồng không được chứa ký tự điều khiển hoặc xuống dòng";

/** Khi AI đọc/dán: NFC + cắt 2 đầu (giữ nguyên văn). Đang gõ (`typing`): chỉ NFC, không cắt để gõ được khoảng trắng. */
export function normalizeDocNumber(raw: string, typing = false): string {
  const s = raw.normalize("NFC");
  return typing ? s : s.trim();
}

/** Rỗng coi là hợp lệ (số chứng từ không bắt buộc). */
export const isValidDocNumber = (v: string): boolean =>
  v === "" || (v.length <= DOC_NUMBER_MAX && !DOC_NUMBER_CONTROL_RE.test(v));

/** Schema server: cắt 2 đầu + NFC; quá dài/ký tự điều khiển ⇒ 422 path `number`. */
export const DocNumberSchema = z
  .string()
  .trim()
  .normalize("NFC")
  .min(1)
  .max(DOC_NUMBER_MAX, { message: `Tối đa ${DOC_NUMBER_MAX} ký tự` })
  .refine((v) => !DOC_NUMBER_CONTROL_RE.test(v), { message: DOC_NUMBER_MESSAGE });
