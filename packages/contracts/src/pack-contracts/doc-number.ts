// CR-122 p12: số chứng từ chỉ gồm chữ không dấu A-Z, số 0-9 và dấu gạch ngang (nhập vào phần mềm kế toán / chuyển ngân hàng không lỗi).
import { z } from "zod";

export const DOC_NUMBER_MAX = 50;
export const DOC_NUMBER_RE = /^[A-Za-z0-9-]+$/;
export const DOC_NUMBER_MESSAGE = "Chỉ dùng chữ không dấu, số và dấu gạch ngang (-)";

/** Chuẩn hoá khi gõ/dán/AI đọc: bỏ dấu tiếng Việt (đ→d), "/" và khoảng trắng → "-", viết HOA. Ký tự lạ khác giữ nguyên (để báo lỗi). */
export function normalizeDocNumber(raw: string, typing = false): string {
  return (typing ? raw : raw.trim())
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[/\s]+/g, "-")
    .toUpperCase();
}

/** Rỗng coi là hợp lệ (số chứng từ không bắt buộc). */
export const isValidDocNumber = (v: string): boolean =>
  v === "" || (v.length <= DOC_NUMBER_MAX && DOC_NUMBER_RE.test(v));

/** Schema server: KHÔNG tự chuẩn hoá — sai định dạng ⇒ 422 path `number`. */
export const DocNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(DOC_NUMBER_MAX, { message: `Tối đa ${DOC_NUMBER_MAX} ký tự` })
  .regex(DOC_NUMBER_RE, { message: DOC_NUMBER_MESSAGE });
