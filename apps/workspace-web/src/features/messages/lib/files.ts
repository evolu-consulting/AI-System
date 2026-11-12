// CR-132 · W3 · luật thuần cho tệp đính kèm: định dạng/dung lượng nhận được (cùng `ATTACH_ALLOWED`/`ATTACH_MAX_BYTES` của server), ảnh hay tệp, cỡ hiển thị.
import { ATTACH_ALLOWED, ATTACH_MAX_BYTES } from "@ai/contracts/attach";

/** Giá trị `accept` của ô chọn tệp: mọi đuôi được nhận. */
export const ATTACH_ACCEPT = Object.keys(ATTACH_ALLOWED)
  .map((e) => `.${e}`)
  .join(",");

export type FileProblem = "type" | "size" | "empty";
/** Kiểm trước khi tải lên (server vẫn kiểm lại): null = hợp lệ. */
export function fileProblem(f: { name: string; size: number }): FileProblem | null {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(ext in ATTACH_ALLOWED) || f.name.indexOf(".") < 0) return "type";
  if (f.size <= 0) return "empty";
  if (f.size > ATTACH_MAX_BYTES) return "size";
  return null;
}

export const isImageMime = (mime: string): boolean => mime.startsWith("image/");

/** `1,2 MB` / `340 KB` / `12 B`. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
