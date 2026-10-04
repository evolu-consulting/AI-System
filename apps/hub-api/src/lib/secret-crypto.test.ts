import { describe, expect, test } from "bun:test";
import { decryptSecret, isMasterKeyB64, parseMasterKey } from "./secret-crypto";

// Vector sinh bằng `encryptSecret` của Admin (apps/admin-api/src/lib/secret-crypto.ts) với rand cố định
// (iv = byte `fill` lặp lại). Khoá thử = byte 0x00..0x1f — không phải khoá thật.
const TEST_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
type Vector = { id: string; value: string; key_version: number; iv: string; ciphertext: string };
const VECTORS: Vector[] = [
  {
    id: "01900000-0000-7000-8000-00000000d001",
    value: "app-TEST-VECTOR-not-a-real-key",
    key_version: 1,
    iv: "070707070707070707070707",
    ciphertext:
      "6e1ad6713b4a84a0ebcb56c3d41ea6b6cf33f95ee9daf37c9fd7739161a79084afb52b5baa73781c93944ba8b2f9",
  },
  {
    id: "01900000-0000-7000-8000-00000000d002",
    value: "khoá-thử ✓ 🔑",
    key_version: 2,
    iv: "a5a5a5a5a5a5a5a5a5a5a5a5",
    ciphertext: "4a2ff36393b15ce1c9170ec24abfe4057d8523c6e5797103afcf831c458ce7d12e5b4da0",
  },
];

const hex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const sealed = (v: Vector) => ({
  ciphertext: hex(v.ciphertext),
  iv: hex(v.iv),
  keyVersion: v.key_version,
});
const [V1, V2] = VECTORS as [Vector, Vector];

describe("HUB-FR-89 · H2a-R17 · secret-crypto (P6, tương thích Admin)", () => {
  test.each(VECTORS)("giải được vector Admin $id", (v) => {
    expect(decryptSecret(parseMasterKey(TEST_KEY_B64, v.key_version), v.id, sealed(v))).toBe(
      v.value,
    );
  });

  test("sai khoá / sai id / sai key_version / sửa tag / iv sai độ dài → ném, không lộ giá trị", () => {
    const k = parseMasterKey(TEST_KEY_B64, 1);
    const other = parseMasterKey(Buffer.alloc(32, 1).toString("base64"), 1);
    expect(() => decryptSecret(other, V1.id, sealed(V1))).toThrow("giải mã thất bại");
    expect(() => decryptSecret(k, V2.id, sealed(V1))).toThrow("giải mã thất bại");
    expect(() => decryptSecret(parseMasterKey(TEST_KEY_B64, 2), V1.id, sealed(V1))).toThrow(
      "key_version",
    );
    const ct = hex(V1.ciphertext);
    ct[ct.length - 1] = (ct[ct.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(k, V1.id, { ...sealed(V1), ciphertext: ct })).toThrow();
    expect(() => decryptSecret(k, V1.id, { ...sealed(V1), iv: new Uint8Array(11) })).toThrow(
      "dữ liệu hỏng",
    );
    expect(() => decryptSecret(k, V1.id, { ...sealed(V1), ciphertext: new Uint8Array(3) })).toThrow(
      "dữ liệu hỏng",
    );
    try {
      decryptSecret(other, V1.id, sealed(V1));
    } catch (e) {
      expect(String(e)).not.toContain(V1.value);
    }
  });

  test("parseMasterKey / isMasterKeyB64", () => {
    expect(isMasterKeyB64(TEST_KEY_B64)).toBe(true);
    for (const bad of [
      Buffer.alloc(31).toString("base64"),
      Buffer.alloc(33).toString("base64"),
      `${TEST_KEY_B64}=`,
      ` ${TEST_KEY_B64}`,
      "",
    ])
      expect(isMasterKeyB64(bad)).toBe(false);
    expect(() => parseMasterKey("KHOA-BAY")).toThrow("SECRET_MASTER_KEY không hợp lệ");
    expect(() => parseMasterKey("KHOA-BAY")).not.toThrow(/KHOA-BAY/);
    expect(parseMasterKey(TEST_KEY_B64).version).toBe(1);
    expect(parseMasterKey(TEST_KEY_B64, 3).version).toBe(3);
  });
});
