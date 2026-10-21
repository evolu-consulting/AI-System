// feedback · luật thuần: giải mã tệp đính kèm base64 (≤ 2 MB), đối chiếu loại khai báo với chữ ký byte (không tin `mime` của client).
import { FEEDBACK_FILE_BYTES_MAX, type FeedbackCreateParsed } from "@ai/contracts";

export type DecodedFile = { name: string; mime: string; bytes: Buffer };

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  "image/gif": (b) => b.subarray(0, 3).toString("latin1") === "GIF",
  "image/webp": (b) =>
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP",
  "application/pdf": (b) => b.subarray(0, 4).toString("latin1") === "%PDF",
  "text/plain": (b) => !b.includes(0),
};

/** Tên an toàn để hiện/tải: bỏ đường dẫn + ký tự điều khiển, tối đa 255. */
export function cleanName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: loại ký tự điều khiển khỏi tên tệp
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f"]/g, "").trim();
  return (base || "file").slice(0, 255);
}

/** `null` nếu tệp hợp lệ, ngược lại mô tả lỗi (route ⇒ 422 VALIDATION_ERROR). */
export function decodeFiles(
  files: FeedbackCreateParsed["files"],
): { ok: true; files: DecodedFile[] } | { ok: false; index: number } {
  const out: DecodedFile[] = [];
  for (const [i, f] of files.entries()) {
    const bytes = Buffer.from(f.data_base64, "base64");
    const sig = SIGNATURES[f.mime];
    if (bytes.length === 0 || bytes.length > FEEDBACK_FILE_BYTES_MAX || !sig?.(bytes))
      return { ok: false, index: i };
    out.push({ name: cleanName(f.name), mime: f.mime, bytes });
  }
  return { ok: true, files: out };
}

/** Admin thấy mọi góp ý trong phạm vi tenant (RLS `app.fb_all`); user thường chỉ của mình. */
export const seesAll = (role: string): boolean =>
  role === "tenant_admin" || role === "platform_admin";
