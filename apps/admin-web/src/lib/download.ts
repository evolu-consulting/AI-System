// ADM-FR-42, ADM-FR-54, ADM-FR-08 · plan-frontend D12 · tải file: fetch kèm Bearer → Blob → <a download> (token không nằm trên URL).
import { apiResponse, type RequestOptions } from "./http";

/** Lấy tên file từ `Content-Disposition` (`filename*=UTF-8''…` ưu tiên, rồi `filename="…"`); không có → `fallback`. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star?.[1]) {
    try {
      return sanitizeName(decodeURIComponent(star[1].trim()), fallback);
    } catch {
      // rơi xuống dạng thường
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(header);
  const name = (plain?.[1] ?? plain?.[2] ?? "").trim();
  return sanitizeName(name, fallback);
}

/** Bỏ đường dẫn và ký tự điều khiển; rỗng → `fallback`. */
function sanitizeName(name: string, fallback: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: loại ký tự điều khiển khỏi tên file
  const base = (name.split(/[/]/).pop() ?? "").replace(/[\u0000-\u001f]/g, "").trim();
  return base || fallback;
}

export type Downloaded = { filename: string; size: number };

/** Tải `path` về máy. Lỗi API ném `ApiError` (gọi nơi dùng tự toast). */
export async function downloadFile(
  path: string,
  opts: RequestOptions & { fallbackName: string },
): Promise<Downloaded> {
  const { fallbackName, ...req } = opts;
  const res = await apiResponse(path, { ...req, headers: { Accept: "*/*", ...req.headers } });
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), fallbackName);
  const blob = await res.blob();
  saveBlob(blob, filename);
  return { filename, size: blob.size };
}

/** Lưu Blob về máy qua `<a download>` (dùng cả cho nội dung tạo ở client, vd mã dự phòng 2FA). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Trình duyệt cần một nhịp để bắt đầu tải trước khi thu hồi URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
