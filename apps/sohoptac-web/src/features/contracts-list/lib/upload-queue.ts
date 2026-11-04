// Gap #9 · luật thuần của hàng đợi tải lên: loại tệp (cả .md), 20 MB/tệp, trạng thái từng tệp. Máy chủ vẫn kiểm lại bằng nội dung.
import { CONTRACT_UPLOAD_MAX_BYTES } from "@ai/contracts";

export const UPLOAD_EXTS = [".pdf", ".docx", ".png", ".jpg", ".jpeg", ".md", ".markdown"] as const;
export const UPLOAD_ACCEPT = UPLOAD_EXTS.join(",");
export const UPLOAD_MAX_BYTES = CONTRACT_UPLOAD_MAX_BYTES;

export type FileCheck = "ok" | "type" | "size" | "empty";

export function checkFile(f: { name: string; size: number }): FileCheck {
  const n = f.name.toLowerCase();
  if (!UPLOAD_EXTS.some((e) => n.endsWith(e))) return "type";
  if (f.size === 0) return "empty";
  return f.size > UPLOAD_MAX_BYTES ? "size" : "ok";
}

export type UploadState = "queued" | "uploading" | "done" | "error";
export type UploadItem = {
  key: number;
  name: string;
  size: number;
  state: UploadState;
  /** Mã HĐ khi xong. */
  id?: string;
  /** Câu lỗi đã dịch. */
  error?: string;
  /** Lỗi từ máy chủ (tệp còn trong hàng đợi) ⇒ cho thử lại; lỗi kiểm tệp phía client thì không. */
  retryable?: boolean;
};

/** "1,5 MB" / "320 KB". */
export function sizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Tiến độ cả lô: số tệp đã xong (thành công hoặc lỗi) / tổng. */
export function batchProgress(items: readonly UploadItem[]): { finished: number; total: number } {
  return {
    finished: items.filter((i) => i.state === "done" || i.state === "error").length,
    total: items.length,
  };
}
