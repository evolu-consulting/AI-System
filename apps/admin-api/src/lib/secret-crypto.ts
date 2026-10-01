// ADM-FR-50, ADM-BR-04, ADM-NFR-01 · mã hoá secret AES-256-GCM (plan M2 §3.2) — định dạng là contract với Hub:
// iv = 12 byte CSPRNG mới mỗi lần ghi; ciphertext = bản mã ‖ tag 16 byte; AAD = UTF-8 `admin.secrets:<id>:<key_version>`;
// khoá = 32 byte base64-decode của SECRET_MASTER_KEY, dùng trực tiếp (tách miền bằng tiền tố AAD, không HKDF).
// Message lỗi không bao giờ chứa khoá, giá trị hay bản mã.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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

const defaultRand = (n: number): Uint8Array => new Uint8Array(randomBytes(n));

export function encryptSecret(
  k: SecretKey,
  id: string,
  value: string,
  rand: (n: number) => Uint8Array = defaultRand,
): SealedSecret {
  const iv = rand(IV_BYTES);
  if (iv.length !== IV_BYTES) throw new Error("secret-crypto: iv phải 12 byte");
  const c = createCipheriv(ALGO, k.key, iv);
  c.setAAD(secretAad(id, k.version));
  const body = Buffer.concat([c.update(value, "utf8"), c.final(), c.getAuthTag()]);
  return { ciphertext: new Uint8Array(body), iv: new Uint8Array(iv), keyVersion: k.version };
}

/** Chỉ test và Hub (sau này) dùng; M2 không có route giải mã. Sai khoá/AAD/tag/key_version → ném. */
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

/** Kiểm lúc khởi động: mã hoá + giải mã thử với id nil (phát hiện môi trường crypto hỏng). */
export function selfTestSecretKey(k: SecretKey): void {
  const nil = "00000000-0000-0000-0000-000000000000";
  if (decryptSecret(k, nil, encryptSecret(k, nil, "self-test-value")) !== "self-test-value")
    throw new Error("secret-crypto: tự kiểm thất bại");
}
