// feedback · luật thuần phía web: kiểm tệp trước khi gửi (khớp trần của contract: 3 tệp × 2 MB, loại ảnh/PDF/văn bản).
export const MAX_FILES = 3;
export const MAX_BYTES = 2 * 1024 * 1024;
const MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
]);

export type PickedFile = { name: string; type: string; size: number };

/** Tệp thêm vào danh sách có hợp lệ không (đếm cả các tệp đã chọn). */
export function canAdd(current: number, f: PickedFile): boolean {
  return current < MAX_FILES && f.size > 0 && f.size <= MAX_BYTES && MIMES.has(f.type);
}

export function statusColor(status: string): string {
  return status === "done" ? "#15803d" : status === "in_progress" ? "#b45309" : "#2563eb";
}

/** `page_url` gửi đi: đường dẫn + query, không origin, tối đa 500 ký tự. */
export function pageOf(loc: { pathname: string; search?: string }): string {
  return `${loc.pathname}${loc.search ?? ""}`.slice(0, 500);
}
