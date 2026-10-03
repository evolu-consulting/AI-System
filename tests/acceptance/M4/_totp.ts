// ADM-FR-08 · M4-R16 · oracle TOTP độc lập (test-plan-cd §0): RFC 4226 (HOTP) / RFC 6238 (TOTP, HMAC-SHA1, 30 s, 6 số)
// + base32 RFC 4648. Tự viết bằng `node:crypto`, KHÔNG import `lib/totp.ts` của sản phẩm (oracle phải độc lập với code
// được kiểm). Không import bun:test để e2e (Node/Playwright) dùng lại được. Tự kiểm: `rules/totp-oracle.test.ts`.
import { createHmac } from "node:crypto";

export const STEP_S = 30;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238 phụ lục B: ASCII "12345678901234567890". */
export const RFC_SECRET_ASCII = "12345678901234567890";
export const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

/** base32 RFC 4648, không padding. */
export function b32(bytes: Uint8Array): string {
  let out = "";
  let buf = 0;
  let bits = 0;
  for (const byte of bytes) {
    buf = (buf << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buf >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buf << (5 - bits)) & 31];
  return out;
}

/** Giải base32 (bỏ khoảng trắng và `=`, không phân biệt hoa thường); ký tự lạ → ném. */
export function unb32(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, "").toUpperCase();
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`base32: ký tự lạ ${JSON.stringify(ch)}`);
    buf = ((buf << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((buf >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** HOTP RFC 4226 (HMAC-SHA1, cắt động, 6 số, giữ số 0 đầu). */
export function hotpOracle(secret: Uint8Array, counter: bigint | number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const off = (mac[mac.length - 1] as number) & 0x0f;
  const bin =
    (((mac[off] as number) & 0x7f) << 24) |
    ((mac[off + 1] as number) << 16) |
    ((mac[off + 2] as number) << 8) |
    (mac[off + 3] as number);
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Bước TOTP của thời điểm `unixS` (giây). */
export const stepOf = (unixS: number): number => Math.floor(unixS / STEP_S);

/** Mã TOTP tại thời điểm `unixS` cho secret base32. */
export function totpAt(secretB32: string, unixS: number): string {
  return hotpOracle(unb32(secretB32), stepOf(unixS));
}

/** Mã 6 số cố định KHÁC mã của mọi bước trong [T-2, T+2] (dùng làm "mã sai" tất định). */
export function wrongCodeAt(secretB32: string, unixS: number): string {
  const near = new Set(
    [-2, -1, 0, 1, 2].map((d) => hotpOracle(unb32(secretB32), stepOf(unixS) + d)),
  );
  for (let n = 0; ; n++) {
    const c = String(n * 111_111 + 123)
      .padStart(6, "0")
      .slice(-6);
    if (!near.has(c)) return c;
  }
}
