// HUB-FR-89, H2a-R17 · P6 · giải mã `admin.secrets` (AES-256-GCM). CHÉP phần giải mã của
// `apps/admin-api/src/lib/secret-crypto.ts` (không import chéo app) — định dạng là contract với Admin:
// iv 12 byte; ciphertext = bản mã ‖ tag 16 byte; AAD = UTF-8 `admin.secrets:<id>:<key_version>`; khoá = 32 byte
// base64 của SECRET_MASTER_KEY dùng trực tiếp. Message lỗi không bao giờ chứa khoá, giá trị hay bản mã.
// Nợ: gộp `packages/secret-crypto` khi combine.
import { createDecipheriv } from "node:crypto";

export type SecretKey = { version: number; key: Uint8Array };
export type SealedSecret = { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number };

export const MASTER_KEY_B64_RE = /^[A-Za-z0-9+/]{43}=$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = "aes-256-gcm";

export function isMasterKeyB64(s: string): boolean {
  return MASTER_KEY_B64_RE.test(s) && Buffer.from(s, "base64").length === 32;
}

/** Ném Error("SECRET_MASTER_KEY không hợp lệ") — không đưa giá trị vào message. */
export function parseMasterKey(b64: string, version = 1): SecretKey {
  if (!isMasterKeyB64(b64)) throw new Error("SECRET_MASTER_KEY không hợp lệ");
  return { version, key: new Uint8Array(Buffer.from(b64, "base64")) };
}

export function secretAad(id: string, keyVersion: number): Uint8Array {
  return new Uint8Array(Buffer.from(`admin.secrets:${id}:${keyVersion}`, "utf8"));
}

/** Sai khoá/AAD/tag/key_version/độ dài → ném (message không chứa dữ liệu). */
export function decryptSecret(k: SecretKey, id: string, s: SealedSecret): string {
  if (s.keyVersion !== k.version) throw new Error("secret-crypto: key_version không khớp");
  const ct = Buffer.from(s.ciphertext);
  if (ct.length < TAG_BYTES || s.iv.length !== IV_BYTES)
    throw new Error("secret-crypto: dữ liệu hỏng");
  try {
    const d = createDecipheriv(ALGO, k.key, s.iv);
    d.setAAD(secretAad(id, s.keyVersion));
    d.setAuthTag(ct.subarray(ct.length - TAG_BYTES));
    return Buffer.concat([d.update(ct.subarray(0, ct.length - TAG_BYTES)), d.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error("secret-crypto: giải mã thất bại");
  }
}
