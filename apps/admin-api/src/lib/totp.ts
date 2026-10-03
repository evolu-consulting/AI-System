// ADM-FR-08 · M4-R16 · TOTP RFC 6238 / HOTP RFC 4226 / base32 RFC 4648 (plan-cd §6, D5). Chỉ `node:crypto`, thuần.
// Không log secret hay mã; so mã bằng timingSafeEqual.
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_S = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const TOTP_SECRET_BYTES = 20;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CODE_RE = /^\d{6}$/;

/** RFC 4648 §6, không padding. */
export function base32Encode(b: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of b) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return out;
}

/** Bỏ khoảng trắng, không phân biệt hoa/thường; ký tự ngoài bảng → ném (message không chứa input). */
export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, "").toUpperCase();
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("base32: ký tự không hợp lệ");
    acc = ((acc << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function hotp(secret: Uint8Array, counter: bigint): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt.asUintN(64, counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = (h[h.length - 1] as number) & 0x0f;
  const bin = h.readUInt32BE(off) & 0x7fffffff;
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function timeStep(now: Date): bigint {
  return BigInt(Math.floor(now.getTime() / 1000 / TOTP_STEP_S));
}

/** Bước khớp trong [T-1, T+1] và > lastUsedStep, so hằng thời gian (timingSafeEqual); không khớp → null. */
export function matchTotp(
  secret: Uint8Array,
  code: string,
  now: Date,
  lastUsedStep: bigint | null,
): bigint | null {
  if (!CODE_RE.test(code)) return null;
  const given = Buffer.from(code, "ascii");
  const t = timeStep(now);
  let hit: bigint | null = null;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const step = t + BigInt(d);
    const same = timingSafeEqual(Buffer.from(hotp(secret, step), "ascii"), given);
    if (same && hit === null && (lastUsedStep === null || step > lastUsedStep)) hit = step;
  }
  return hit;
}

/** Key URI (Google Authenticator): nhãn `issuer:account`, SHA1/6/30. Không log giá trị trả về. */
export function otpauthUrl(a: { secretB32: string; issuer: string; account: string }): string {
  const enc = encodeURIComponent;
  const label = `${enc(a.issuer)}:${enc(a.account)}`;
  return (
    `otpauth://totp/${label}?secret=${a.secretB32}&issuer=${enc(a.issuer)}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_S}`
  );
}
