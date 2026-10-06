// HUB-FR-72 · localStorage an toàn (chế độ riêng tư/chặn site data có thể ném) — chỉ dùng cho tiện ích từng người xem.
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // bỏ qua: trang vẫn chạy không cần lưu
  }
}
