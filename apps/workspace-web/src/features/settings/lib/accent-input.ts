// CR-138 Q8 · ô «Màu tự chọn»: luật thuần cho ô nhập mã màu (chuẩn hoá, kiểm cú pháp + tương phản AA 4.5:1 với chữ trắng).
import { checkAccent, isAccentHex, isAccentPreset } from "@ai/contracts/pack-contracts";

export type AccentIssue = "invalid" | "low";

/** Chuẩn hoá chữ người nhập: bỏ khoảng trắng, thêm `#` nếu thiếu và đủ 6 ký tự hex, chữ thường khi hợp lệ. */
export function normalizeHex(raw: string): string {
  const t = raw.trim();
  const withHash = /^[0-9a-fA-F]{6}$/.test(t) ? `#${t}` : t;
  return isAccentHex(withHash) ? withHash.toLowerCase() : withHash;
}

/** Lỗi của giá trị màu: khoá đặt sẵn ⇒ không lỗi; mã sai dạng ⇒ `invalid`; mã nhạt (tương phản < 4.5) ⇒ `low`. */
export function accentIssue(accent: string): AccentIssue | null {
  if (isAccentPreset(accent)) return null;
  if (!isAccentHex(accent)) return "invalid";
  return checkAccent(accent).ok ? null : "low";
}
