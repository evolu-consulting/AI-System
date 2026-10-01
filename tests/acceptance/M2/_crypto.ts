// ADM-FR-50, ADM-NFR-01 · bản hiện thực ĐỘC LẬP của AES-256-GCM theo plan.md §3.2 (contract với Hub). KHÔNG import code
// sản phẩm: dùng để đối chiếu bản mã do admin-api ghi (test-plan R2, S). Khoá dùng trực tiếp (không HKDF).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const aadOf = (id: string, keyVersion: number): Buffer =>
  Buffer.from(`admin.secrets:${id}:${keyVersion}`, "utf8");

export const newMasterKeyB64 = (): string => randomBytes(32).toString("base64");

export type Sealed = { ciphertext: Uint8Array; iv: Uint8Array };

/** Mã hoá: ciphertext = bản mã ‖ tag 16 byte. */
export function sealIndependent(
  keyB64: string,
  id: string,
  keyVersion: number,
  value: string,
  iv: Buffer = randomBytes(12),
): { ciphertext: Buffer; iv: Buffer } {
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv);
  c.setAAD(aadOf(id, keyVersion));
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return { ciphertext: Buffer.concat([body, c.getAuthTag()]), iv };
}

/** Giải mã theo plan §3.2: iv = cột iv, tag = 16 byte cuối, AAD = `admin.secrets:<id>:<key_version>`. Ném khi sai. */
export function openIndependent(
  keyB64: string,
  id: string,
  keyVersion: number,
  sealed: Sealed,
  aad: Buffer = aadOf(id, keyVersion),
): string {
  const ct = Buffer.from(sealed.ciphertext);
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), Buffer.from(sealed.iv));
  d.setAAD(aad);
  d.setAuthTag(ct.subarray(ct.length - 16));
  return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString("utf8");
}
