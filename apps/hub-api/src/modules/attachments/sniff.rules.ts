// HUB-FR-44 · H2c-R03 · kiểm nội dung theo đuôi (plan-rules §2): chữ ký đầu file, chặn file chạy được, nhóm chữ UTF-8.
import type { AttachExt } from "./attachment.rules";

export const SNIFF_HEAD = 16;

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);

const MZ = [0x4d, 0x5a];
const ELF = [0x7f, 0x45, 0x4c, 0x46];
const SHEBANG = [0x23, 0x21];
const BOM = [0xef, 0xbb, 0xbf];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** Nhóm chữ: chữ ký luôn đạt, kiểm UTF-8 + byte 0 ở `FileInspector`. */
const TEXT_EXTS: ReadonlySet<AttachExt> = new Set(["txt", "md", "csv", "xml", "json"]);

/** Chữ ký đầu file theo đuôi nhị phân. */
const SIGNATURE: Partial<Record<AttachExt, (h: Uint8Array) => boolean>> = {
  pdf: (h) => startsWith(h, ascii("%PDF-")),
  png: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (h) => startsWith(h, [0xff, 0xd8, 0xff]),
  jpeg: (h) => startsWith(h, [0xff, 0xd8, 0xff]),
  gif: (h) => startsWith(h, ascii("GIF87a")) || startsWith(h, ascii("GIF89a")),
  webp: (h) => startsWith(h, ascii("RIFF")) && startsWith(h, ascii("WEBP"), 8),
  docx: (h) => startsWith(h, ZIP),
  xlsx: (h) => startsWith(h, ZIP),
  pptx: (h) => startsWith(h, ZIP),
};

/** `MZ` ∨ ELF ∨ `#!` (bỏ BOM UTF-8 đầu rồi xét lại `#!`). */
export function isExecutableHead(head: Uint8Array): boolean {
  if (startsWith(head, MZ) || startsWith(head, ELF) || startsWith(head, SHEBANG)) return true;
  return startsWith(head, BOM) && startsWith(head, SHEBANG, BOM.length);
}

/** ≤ 16 byte đầu khớp chữ ký của `ext` (nhóm chữ: true); file chạy được hoặc ngắn hơn chữ ký → false. */
export function headOk(ext: AttachExt, head: Uint8Array): boolean {
  if (isExecutableHead(head)) return false;
  if (TEXT_EXTS.has(ext)) return true;
  return SIGNATURE[ext]?.(head) ?? false;
}

/** Kiểm từng chunk khi ghi (`ChunkInspector` của `storage.ts`); `false` = từ chối (415), đã false thì luôn false. */
export class FileInspector {
  readonly #head = new Uint8Array(SNIFF_HEAD);
  #headLen = 0;
  #decided = false;
  #ok = true;
  readonly #utf8: TextDecoder | null;

  constructor(readonly ext: AttachExt) {
    this.#utf8 = TEXT_EXTS.has(ext) ? new TextDecoder("utf-8", { fatal: true }) : null;
  }

  push(chunk: Uint8Array): boolean {
    if (!this.#ok || chunk.length === 0) return this.#ok;
    if (!this.#decided) {
      const n = Math.min(SNIFF_HEAD - this.#headLen, chunk.length);
      this.#head.set(chunk.subarray(0, n), this.#headLen);
      this.#headLen += n;
      if (this.#headLen === SNIFF_HEAD) this.#decide();
    }
    if (this.#ok && this.#utf8) this.#ok = textOk(this.#utf8, chunk);
    return this.#ok;
  }

  end(): boolean {
    if (!this.#ok) return false;
    if (!this.#decided && this.#headLen > 0) this.#decide();
    if (this.#ok && this.#utf8) this.#ok = textOk(this.#utf8);
    return this.#ok;
  }

  #decide(): void {
    this.#decided = true;
    this.#ok = headOk(this.ext, this.#head.subarray(0, this.#headLen));
  }
}

/** Không byte 0, UTF-8 hợp lệ (giải mã dòng; `chunk` vắng = kết thúc — chuỗi cắt dở ⇒ false). */
function textOk(dec: TextDecoder, chunk?: Uint8Array): boolean {
  if (chunk?.includes(0)) return false;
  try {
    if (chunk) dec.decode(chunk, { stream: true });
    else dec.decode();
    return true;
  } catch {
    return false;
  }
}
