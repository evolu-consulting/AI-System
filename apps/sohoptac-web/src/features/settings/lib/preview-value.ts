// CR-108 · ô "Giá trị mẫu" của Xem trước đường đi: định dạng khi gõ (vi-VN: 500.000.000), đọc ngược về số, nút chọn nhanh,
// và câu tóm tắt "Hợp đồng này đi qua N/M bước". Hàm thuần, không phụ thuộc React/i18n.
import type { CurrentStep } from "./current-flow";

/** Giá trị tối đa nhập được (khớp `APPROVAL_FLOW_VALUE_MAX`): 16 chữ số vẫn an toàn với `Number`, nhưng cắt ở 15 cho gọn. */
const MAX_DIGITS = 15;

/** Chỉ giữ chữ số (bỏ dấu ngăn nghìn `.` `,` khoảng trắng, chữ), bỏ số 0 đầu, cắt tối đa 15 chữ số. */
export function digitsOf(text: string): string {
  const d = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return d.slice(0, MAX_DIGITS);
}

/** Chuỗi chữ số ⇒ hiển thị có ngăn nghìn bằng `.` ("500000000" ⇒ "500.000.000"); rỗng ⇒ rỗng. */
export function formatDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Văn bản người dùng gõ ⇒ số (null nếu trống / không có chữ số). */
export function parseValue(text: string): number | null {
  const d = digitsOf(text);
  return d === "" ? null : Number(d);
}

/** Số ⇒ chuỗi chữ số của ô nhập (null ⇒ rỗng). */
export const digitsFromValue = (v: number | null): string =>
  v === null ? "" : String(Math.trunc(v));

/** Nút chọn nhanh: khoá i18n (`contracts.flow.quick.<key>`) + giá trị (null = để trống). */
export const QUICK_VALUES: readonly {
  key: "m100" | "m500" | "b1" | "empty";
  value: number | null;
}[] = [
  { key: "m100", value: 100_000_000 },
  { key: "m500", value: 500_000_000 },
  { key: "b1", value: 1_000_000_000 },
  { key: "empty", value: null },
];

/** Tóm tắt đường đi: số bước chạy / tổng, tên các bước chạy theo thứ tự. */
export function runSummary(
  steps: readonly CurrentStep[],
  run: readonly boolean[],
): { n: number; m: number; names: string[] } {
  const names = steps.filter((_, i) => run[i]).map((s) => s.name);
  return { n: names.length, m: steps.length, names };
}
