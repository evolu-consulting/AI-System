// ADM-FR-01, ADM-FR-60, ADM-FR-04 · chuẩn hoá mã công ty / tên đăng nhập trước khi gửi (khớp contract: trim + lowercase).

/** Chữ thường, bỏ dấu, `đ` → `d`; **không** trim (dùng khi đang gõ để không nuốt dấu cách giữa chừng). */
export function foldKeyInput(input: string): string {
  return input
    .toLowerCase()
    .replaceAll("đ", "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
}

/** Mã công ty gửi lên server: trim + chữ thường + bỏ dấu. */
export function normalizeCompanyKey(input: string): string {
  return foldKeyInput(input.trim());
}

/** Tên đăng nhập gửi lên server: trim + chữ thường (không bỏ dấu; sai định dạng do server từ chối). */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}
