// ADM-FR-50, ADM-NFR-01 · AES-256-GCM theo plan.md §3.2 (test-plan R2; M2-R02, M2-AC02).
// Bản hiện thực ĐỘC LẬP (`../_crypto.ts`) đối chiếu đầu ra của sản phẩm: format là contract với Hub (A7).
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { aadOf, newMasterKeyB64, openIndependent, sealIndependent } from "../_crypto";
import { LEAK_1 } from "../_data";
import { loadSecretCrypto } from "../_modules";

const ID = "01900000-0000-7000-8000-0000000002f1";
const OTHER_ID = "01900000-0000-7000-8000-0000000002f2";
const KEY_B64 = newMasterKeyB64();
const FIXED_IV = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

async function setup() {
  const sc = await loadSecretCrypto();
  return { sc, key: sc.parseMasterKey(KEY_B64) };
}

describe("ADM-FR-50 · secret-crypto", () => {
  it("ADM-FR-50 · M2-R02 · khứ hồi: ASCII, tiếng Việt, emoji, đúng 8 và đúng 2048 ký tự", async () => {
    const { sc, key } = await setup();
    for (const v of [LEAK_1, "Khóa-bí-mật-Việt", "😀😀😀😀😀", "12345678", "x".repeat(2048)]) {
      const sealed = sc.encryptSecret(key, ID, v);
      expect(sc.decryptSecret(key, ID, sealed)).toBe(v);
    }
  });

  it("ADM-FR-50 · M2-R02 · ciphertext = utf8 + 16 byte tag; iv 12 byte; keyVersion 1", async () => {
    const { sc, key } = await setup();
    const v = "Khóa-bí-mật-😀";
    const s = sc.encryptSecret(key, ID, v);
    expect(s.ciphertext.length).toBe(Buffer.byteLength(v, "utf8") + 16);
    expect(s.iv.length).toBe(12);
    expect(s.keyVersion).toBe(1);
  });

  it("ADM-FR-50 · M2-AC02 · hai lần mã hoá cùng giá trị/cùng id cho iv và ciphertext khác nhau", async () => {
    const { sc, key } = await setup();
    const a = sc.encryptSecret(key, ID, LEAK_1);
    const b = sc.encryptSecret(key, ID, LEAK_1);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("ADM-FR-50 · M2-R02 · rand giả (12 byte cố định) → iv đúng dãy đó, kết quả tất định", async () => {
    const { sc, key } = await setup();
    const rand = (n: number) => FIXED_IV.slice(0, n);
    const a = sc.encryptSecret(key, ID, LEAK_1, rand);
    const b = sc.encryptSecret(key, ID, LEAK_1, rand);
    expect(Array.from(a.iv)).toEqual(Array.from(FIXED_IV));
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(true);
  });

  it("ADM-FR-50 · M2-R02 · vector vàng: ciphertext bằng bản hiện thực độc lập (khoá dùng trực tiếp, AAD admin.secrets:<id>:1, tag nối cuối)", async () => {
    const { sc, key } = await setup();
    const rand = (n: number) => FIXED_IV.slice(0, n);
    const mine = sealIndependent(KEY_B64, ID, 1, LEAK_1, Buffer.from(FIXED_IV));
    const theirs = sc.encryptSecret(key, ID, LEAK_1, rand);
    expect(Buffer.from(theirs.ciphertext).toString("hex")).toBe(mine.ciphertext.toString("hex"));
    expect(Buffer.from(theirs.iv).toString("hex")).toBe(mine.iv.toString("hex"));
  });

  it("ADM-FR-50 · M2-R02 · bản độc lập giải mã được đầu ra của sản phẩm (iv = cột iv, tag = 16 byte cuối)", async () => {
    const { sc, key } = await setup();
    const sealed = sc.encryptSecret(key, ID, LEAK_1);
    expect(openIndependent(KEY_B64, ID, 1, sealed)).toBe(LEAK_1);
  });

  it("ADM-FR-50 · M2-R02 · sai khoá (đổi 1 byte) → ném", async () => {
    const { sc, key } = await setup();
    const sealed = sc.encryptSecret(key, ID, LEAK_1);
    const bytes = Buffer.from(KEY_B64, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const wrong = sc.parseMasterKey(bytes.toString("base64"));
    expect(() => sc.decryptSecret(wrong, ID, sealed)).toThrow();
    expect(() => openIndependent(bytes.toString("base64"), ID, 1, sealed)).toThrow();
  });

  it("ADM-FR-50 · M2-AC02 · AAD sai → ném: id khác, key_version khác, thiếu tiền tố admin.secrets:, hoán đổi giữa hai secret", async () => {
    const { sc, key } = await setup();
    const sealed = sc.encryptSecret(key, ID, LEAK_1);
    expect(() => sc.decryptSecret(key, OTHER_ID, sealed)).toThrow();
    expect(() => sc.decryptSecret(sc.parseMasterKey(KEY_B64, 2), ID, sealed)).toThrow();
    expect(() => sc.decryptSecret(key, ID, { ...sealed, keyVersion: 2 })).toThrow();
    expect(() => openIndependent(KEY_B64, ID, 1, sealed, Buffer.from(ID, "utf8"))).toThrow();
    expect(() => openIndependent(KEY_B64, ID, 2, sealed)).toThrow();
    const other = sc.encryptSecret(key, OTHER_ID, "another-secret-value");
    expect(() => sc.decryptSecret(key, ID, other)).toThrow();
  });

  it("ADM-FR-50 · M2-AC02 · sửa 1 byte của tag / bản mã / iv → ném", async () => {
    const { sc, key } = await setup();
    const sealed = sc.encryptSecret(key, ID, LEAK_1);
    const flip = (b: Uint8Array, at: number) => {
      const c = Uint8Array.from(b);
      c[at] = (c[at] ?? 0) ^ 1;
      return c;
    };
    const last = sealed.ciphertext.length - 1;
    expect(() =>
      sc.decryptSecret(key, ID, { ...sealed, ciphertext: flip(sealed.ciphertext, last) }),
    ).toThrow();
    expect(() =>
      sc.decryptSecret(key, ID, { ...sealed, ciphertext: flip(sealed.ciphertext, 0) }),
    ).toThrow();
    expect(() => sc.decryptSecret(key, ID, { ...sealed, iv: flip(sealed.iv, 0) })).toThrow();
  });

  it("ADM-FR-50 · M2-R02 · secretAad(id, kv) = UTF-8 `admin.secrets:<id>:<kv>`", async () => {
    const { sc } = await setup();
    expect(Buffer.from(sc.secretAad(ID, 1)).toString("utf8")).toBe(`admin.secrets:${ID}:1`);
    expect(Buffer.from(sc.secretAad(ID, 3)).equals(aadOf(ID, 3))).toBe(true);
  });

  it("ADM-FR-50 · M2-R02 · isMasterKeyB64: 43 ký tự + '=' (32 byte) hợp lệ; 31/33 byte, url-safe, xuống dòng, rỗng, thiếu '=' → sai; parseMasterKey trả version", async () => {
    const { sc } = await setup();
    expect(sc.isMasterKeyB64(KEY_B64)).toBe(true);
    expect(sc.isMasterKeyB64(randomBytes(31).toString("base64"))).toBe(false);
    expect(sc.isMasterKeyB64(randomBytes(33).toString("base64"))).toBe(false);
    const raw = Buffer.alloc(32, 0xfb).toString("base64");
    expect(raw).toMatch(/[+/]/);
    expect(sc.isMasterKeyB64(raw.replace(/\+/g, "-").replace(/\//g, "_"))).toBe(false);
    expect(sc.isMasterKeyB64(`${KEY_B64}\n`)).toBe(false);
    expect(sc.isMasterKeyB64(KEY_B64.slice(0, 43))).toBe(false);
    expect(sc.isMasterKeyB64("")).toBe(false);
    expect(sc.isMasterKeyB64("=")).toBe(false);
    const k = sc.parseMasterKey(KEY_B64);
    expect(k.version).toBe(1);
    expect(k.key.length).toBe(32);
    expect(sc.parseMasterKey(KEY_B64, 2).version).toBe(2);
  });

  it("ADM-NFR-01 · M2-R02 · thông điệp lỗi của parseMasterKey/decryptSecret không chứa khoá, plaintext hay bản mã", async () => {
    const { sc, key } = await setup();
    const bad = "KEY-MARKER-NOT-BASE64-0123456789";
    let msg = "";
    try {
      sc.parseMasterKey(bad);
    } catch (e) {
      msg = String((e as Error).message);
    }
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain(bad);
    const sealed = sc.encryptSecret(key, ID, LEAK_1);
    let msg2 = "";
    try {
      sc.decryptSecret(key, OTHER_ID, sealed);
    } catch (e) {
      msg2 = String((e as Error).message);
    }
    expect(msg2).not.toContain(LEAK_1);
    expect(msg2).not.toContain(KEY_B64);
    expect(msg2).not.toContain(Buffer.from(sealed.ciphertext).toString("base64"));
  });
});
