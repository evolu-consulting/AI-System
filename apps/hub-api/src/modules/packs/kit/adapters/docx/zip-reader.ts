// PK-FR-07 · ADR-0024 §4: đọc central directory zip bằng tay (thấy mọi phần + kích thước khai báo TRƯỚC khi giải nén) và
// giải nén một phần bằng `fflate` `Inflate` theo mảnh, đếm byte THẬT — vượt kích thước khai báo ⇒ dừng ngay (không tin header).
import { Inflate } from "fflate";

export class ZipError extends Error {}

export type ZipEntryInfo = {
  name: string;
  method: number;
  flags: number;
  /** Kích thước nén. */
  size: number;
  /** Kích thước giải nén khai báo. */
  originalSize: number;
  localOffset: number;
};

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const MAX_U32 = 0xffffffff;
/** Mảnh đầu vào mỗi lần `push` — đầu ra mỗi mảnh ≤ ~1032 × 16 KiB dù dữ liệu độc. */
const CHUNK = 16 * 1024;
const utf8 = new TextDecoder("utf-8");

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Có chữ ký `PK\x03\x04` ở đầu (loại PDF/ảnh/OLE2 mã hoá ngay). */
export const looksLikeZip = (b: Uint8Array): boolean =>
  b.length >= 22 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;

function findEocd(dv: DataView): number {
  const min = Math.max(0, dv.byteLength - 22 - 0xffff);
  for (let i = dv.byteLength - 22; i >= min; i--) if (dv.getUint32(i, true) === SIG_EOCD) return i;
  throw new ZipError("no EOCD");
}

/** Đọc tối đa `limit` mục central directory (đủ để luật thấy "quá nhiều phần" mà không duyệt hết). */
export function readCentralDirectory(b: Uint8Array, limit: number): ZipEntryInfo[] {
  const dv = view(b);
  const eocd = findEocd(dv);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntryInfo[] = [];
  for (let i = 0; i < count && out.length < limit; i++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== SIG_CEN) throw new ZipError("bad CEN");
    const nameLen = dv.getUint16(p + 28, true);
    const skip = nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    if (p + 46 + nameLen > b.length) throw new ZipError("bad name");
    const e: ZipEntryInfo = {
      flags: dv.getUint16(p + 8, true),
      method: dv.getUint16(p + 10, true),
      size: dv.getUint32(p + 20, true),
      originalSize: dv.getUint32(p + 24, true),
      localOffset: dv.getUint32(p + 42, true),
      name: utf8.decode(b.subarray(p + 46, p + 46 + nameLen)),
    };
    if (e.size === MAX_U32 || e.originalSize === MAX_U32) throw new ZipError("zip64");
    out.push(e);
    p += 46 + skip;
  }
  return out;
}

function compressedData(b: Uint8Array, e: ZipEntryInfo): Uint8Array {
  const dv = view(b);
  const p = e.localOffset;
  if (p + 30 > b.length || dv.getUint32(p, true) !== SIG_LOC) throw new ZipError("bad LOC");
  const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
  if (start + e.size > b.length) throw new ZipError("truncated");
  return b.subarray(start, start + e.size);
}

/** Giải nén một phần; byte thật phải ĐÚNG bằng kích thước khai báo (lớn hơn ⇒ dừng ngay ở mảnh vượt). */
export function extractEntry(b: Uint8Array, e: ZipEntryInfo): Uint8Array {
  if (e.flags & 1) throw new ZipError("encrypted");
  const comp = compressedData(b, e);
  if (e.method === 0) {
    if (comp.length !== e.originalSize) throw new ZipError("size mismatch");
    return comp;
  }
  if (e.method !== 8) throw new ZipError("method");
  const out = new Uint8Array(e.originalSize);
  let pos = 0;
  const inf = new Inflate((chunk) => {
    if (pos + chunk.length > out.length) throw new ZipError("bigger than declared");
    out.set(chunk, pos);
    pos += chunk.length;
  });
  if (comp.length === 0) throw new ZipError("empty deflate");
  for (let o = 0; o < comp.length; o += CHUNK)
    inf.push(comp.subarray(o, o + CHUNK), o + CHUNK >= comp.length);
  if (pos !== out.length) throw new ZipError("smaller than declared");
  return out;
}
