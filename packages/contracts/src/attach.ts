// HUB-FR-44 · H2c đính kèm (plan H2c §2.1): gốc dùng chung kênh chat và contract hub; re-export từ `common.ts`.
// Không import I/O: chạy được ở trình duyệt.
import { z } from "zod";

/** 20 MiB — trần mỗi file đính kèm. */
export const ATTACH_MAX_BYTES = 20_971_520;
/** Đuôi (chữ thường) → MIME được phép (Q1 = A). */
export const ATTACH_ALLOWED = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  xml: "application/xml",
  json: "application/json",
} as const;
export type AttachMime = (typeof ATTACH_ALLOWED)[keyof typeof ATTACH_ALLOWED];
/** MIME duy nhất, theo thứ tự xuất hiện trong `ATTACH_ALLOWED`. */
export const ATTACH_MIMES = [...new Set(Object.values(ATTACH_ALLOWED))] as [
  AttachMime,
  ...AttachMime[],
];
export const AttachMimeSchema = z.enum(ATTACH_MIMES);
