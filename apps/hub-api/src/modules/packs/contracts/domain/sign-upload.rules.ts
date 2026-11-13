// CR-141 · bước «Ký hợp đồng»: làm MỘT trong hai (ký số, hoặc tải lên bản đã ký) mới qua bước. Luật thuần, lớp 1.
// Tệp tải lên: PDF / JPG / PNG (bản scan hoặc ảnh HĐ/biên bản có chữ ký, dấu).
const TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
export const SIGNED_UPLOAD_LABEL = "PDF, JPG, PNG";

/** Tên tệp ⇒ mime nhận được, hoặc null (định dạng chưa nhận). */
export function signedUploadMime(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : (TYPES[name.slice(dot + 1).toLowerCase()] ?? null);
}

/** Bước qua khi: đã ký số xong HOẶC đã có tệp bản ký tải lên. Không có cái nào ⇒ chưa qua (không «Hoàn tất» được). */
export function signStepPasses(s: { digitallySigned: boolean; uploadedFile: boolean }): boolean {
  return s.digitallySigned || s.uploadedFile;
}

export type UploadVerdict =
  | { ok: true; override: boolean }
  | { ok: false; reason: "not_awaiting" | "forbidden" };

/** Ai được tải bản ký: người được giao bước; Toàn quyền duyệt thay (`override` ⇒ ghi rõ «duyệt thay»). Bước không còn chờ ⇒ không tải. */
export function signedUploadVerdict(a: {
  awaiting: boolean;
  assigned: readonly string[];
  userId: string;
  admin: boolean;
}): UploadVerdict {
  if (!a.awaiting) return { ok: false, reason: "not_awaiting" };
  if (a.assigned.includes(a.userId)) return { ok: true, override: false };
  return a.admin ? { ok: true, override: true } : { ok: false, reason: "forbidden" };
}

const MAGIC: Readonly<Record<string, readonly number[]>> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
};

export type UploadCheck = { ok: true; mime: string } | { ok: false; reason: "ext" | "content" };
/** Đuôi tệp VÀ nội dung (chữ ký đầu tệp %PDF / FFD8FF / 89504E47) phải khớp: đổi đuôi một tệp khác không qua được. */
export function checkSignedUpload(name: string, bytes: Uint8Array): UploadCheck {
  const mime = signedUploadMime(name);
  if (!mime) return { ok: false, reason: "ext" };
  const sig = MAGIC[mime] ?? [];
  return sig.every((b, i) => bytes[i] === b)
    ? { ok: true, mime }
    : { ok: false, reason: "content" };
}
