// HUB-FR-44 · H2c-R03 · kiểm nội dung theo đuôi (plan-rules §2): chữ ký đầu file, chặn file chạy được, nhóm chữ UTF-8.
// B0: chỉ chữ ký (thân ném `not implemented`) — B2.
import type { AttachExt } from "./attachment.rules";

export const SNIFF_HEAD = 16;

/** `MZ` ∨ ELF ∨ `#!` (bỏ BOM UTF-8 đầu rồi xét lại `#!`). */
export function isExecutableHead(_head: Uint8Array): boolean {
  throw new Error("not implemented: isExecutableHead");
}

/** ≤ 16 byte đầu khớp chữ ký của `ext` (nhóm chữ: true); file chạy được hoặc ngắn hơn chữ ký → false. */
export function headOk(_ext: AttachExt, _head: Uint8Array): boolean {
  throw new Error("not implemented: headOk");
}

/** Kiểm từng chunk khi ghi (`ChunkInspector` của `storage.ts`); `false` = từ chối (415), đã false thì luôn false. */
export class FileInspector {
  constructor(readonly ext: AttachExt) {}

  push(_chunk: Uint8Array): boolean {
    throw new Error("not implemented: FileInspector.push");
  }

  end(): boolean {
    throw new Error("not implemented: FileInspector.end");
  }
}
