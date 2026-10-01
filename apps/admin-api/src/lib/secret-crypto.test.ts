import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  isMasterKeyB64,
  parseMasterKey,
  secretAad,
  selfTestSecretKey,
} from "./secret-crypto";

const B64 = randomBytes(32).toString("base64");
const ID = "01900000-0000-7000-8000-00000000d001";

describe("ADM-FR-50 · secret-crypto", () => {
  test("khứ hồi; IV và bản mã khác nhau mỗi lần; ciphertext = utf8 + 16", () => {
    const k = parseMasterKey(B64);
    const a = encryptSecret(k, ID, "giá-trị-bí-mật");
    const b = encryptSecret(k, ID, "giá-trị-bí-mật");
    expect(decryptSecret(k, ID, a)).toBe("giá-trị-bí-mật");
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(a.ciphertext.length).toBe(Buffer.byteLength("giá-trị-bí-mật") + 16);
  });

  test("rand giả → tất định", () => {
    const k = parseMasterKey(B64);
    const rand = (n: number) => new Uint8Array(n).fill(9);
    const a = encryptSecret(k, ID, "12345678", rand);
    const b = encryptSecret(k, ID, "12345678", rand);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(true);
    expect(() => encryptSecret(k, ID, "x", (n) => new Uint8Array(n - 1))).toThrow();
  });

  test("sai khoá / sai id / sai key_version / sửa tag → ném, message không chứa giá trị", () => {
    const k = parseMasterKey(B64);
    const s = encryptSecret(k, ID, "VALUE-MARKER-123");
    const other = parseMasterKey(randomBytes(32).toString("base64"));
    expect(() => decryptSecret(other, ID, s)).toThrow("giải mã thất bại");
    expect(() => decryptSecret(k, "01900000-0000-7000-8000-00000000d002", s)).toThrow();
    expect(() => decryptSecret(parseMasterKey(B64, 2), ID, s)).toThrow("key_version");
    const ct = Uint8Array.from(s.ciphertext);
    ct[ct.length - 1] = (ct[ct.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(k, ID, { ...s, ciphertext: ct })).toThrow();
    expect(() => decryptSecret(k, ID, { ...s, ciphertext: new Uint8Array(3) })).toThrow();
  });

  test("isMasterKeyB64 / parseMasterKey", () => {
    expect(isMasterKeyB64(B64)).toBe(true);
    for (const bad of [
      randomBytes(31).toString("base64"),
      randomBytes(33).toString("base64"),
      `${B64}=`,
      ` ${B64}`,
      "",
    ])
      expect(isMasterKeyB64(bad)).toBe(false);
    expect(() => parseMasterKey("KHOA-BAY")).toThrow("SECRET_MASTER_KEY không hợp lệ");
    expect(() => parseMasterKey("KHOA-BAY")).not.toThrow(/KHOA-BAY/);
    expect(parseMasterKey(B64, 3).version).toBe(3);
  });

  test("secretAad + selfTest", () => {
    expect(Buffer.from(secretAad(ID, 1)).toString()).toBe(`admin.secrets:${ID}:1`);
    expect(() => selfTestSecretKey(parseMasterKey(B64))).not.toThrow();
  });
});
