// ADM-FR-08 · M4-R16 · plan-cd D2–D3: sealBytes/openBytes (AAD miền 2FA) + pepper HMAC mã dự phòng.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  backupCodePepper,
  encryptSecret,
  hashBackupCode,
  openBytes,
  parseMasterKey,
  sealBytes,
  secretAad,
  totpAad,
} from "./secret-crypto";

const K = parseMasterKey(randomBytes(32).toString("base64"));
const UID = "01900000-0000-7000-8000-00000000d001";
const plain = Uint8Array.from({ length: 20 }, (_, i) => i);

describe("ADM-FR-08 · secret-crypto 2FA", () => {
  test("ADM-FR-08 · sealBytes 20 byte → ct 36 byte, iv 12; openBytes khứ hồi", () => {
    const s = sealBytes(K, totpAad(UID, 1), plain);
    expect([s.ciphertext.length, s.iv.length, s.keyVersion]).toEqual([36, 12, 1]);
    expect(Array.from(openBytes(K, totpAad(UID, 1), s))).toEqual(Array.from(plain));
  });

  test("ADM-FR-08 · tách miền: AAD user khác / AAD admin.secrets / khoá khác → ném", () => {
    const s = sealBytes(K, totpAad(UID, 1), plain);
    const other = "01900000-0000-7000-8000-00000000d002";
    expect(() => openBytes(K, totpAad(other, 1), s)).toThrow("giải mã thất bại");
    expect(() => openBytes(K, secretAad(UID, 1), s)).toThrow("giải mã thất bại");
    const k2 = parseMasterKey(randomBytes(32).toString("base64"));
    expect(() => openBytes(k2, totpAad(UID, 1), s)).toThrow("giải mã thất bại");
    const e = encryptSecret(K, UID, "x");
    expect(() => openBytes(K, totpAad(UID, 1), e)).toThrow("giải mã thất bại");
  });

  test("ADM-FR-08 · pepper tất định theo khoá, 32 byte, khác khoá thô; hash 32 byte, khác SHA-256 trần", () => {
    const p = backupCodePepper(K);
    expect(p.length).toBe(32);
    expect(Array.from(backupCodePepper(K))).toEqual(Array.from(p));
    expect(Buffer.from(p).equals(Buffer.from(K.key))).toBe(false);
    const h = hashBackupCode(p, "k7p29xqm");
    expect(h.length).toBe(32);
    const bare = new Bun.CryptoHasher("sha256").update("k7p29xqm").digest();
    expect(Buffer.from(h).equals(bare)).toBe(false);
    expect(Buffer.from(hashBackupCode(p, "k7p29xqn")).equals(Buffer.from(h))).toBe(false);
  });
});
