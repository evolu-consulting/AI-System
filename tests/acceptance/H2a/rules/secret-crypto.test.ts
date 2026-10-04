// HUB-FR-89 · HUB-H2a-AC-04 · H2a-R17, P6 · giải mã secret Hub = định dạng `encryptSecret` Admin
// (test-plan H2a §4 R63, cases §1.8). Khoá thử cố định, không phải khoá thật.
import { describe, expect, it } from "bun:test";
import * as adminCrypto from "../../../../apps/admin-api/src/lib/secret-crypto";
import { decryptSecret, parseMasterKey } from "../../../../apps/hub-api/src/lib/secret-crypto";
import { LEAK, uid } from "./_catalog";

const MASTER = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 9).toString("base64");
const ID = uid(201);
const fixedRand = (n: number) => new Uint8Array(n).fill(3);

describe("HUB-FR-89 · secret-crypto Hub ↔ Admin [R63]", () => {
  it("HUB-FR-89 · H2a-R17 · giải được vector encryptSecret Admin; khoá/iv/id/key_version sai → ném [R63]", () => {
    const sealed = adminCrypto.encryptSecret(
      adminCrypto.parseMasterKey(MASTER),
      ID,
      LEAK,
      fixedRand,
    );
    const k = parseMasterKey(MASTER);
    expect(decryptSecret(k, ID, sealed)).toBe(LEAK);
    expect(() => decryptSecret(parseMasterKey(OTHER), ID, sealed)).toThrow();
    const iv = new Uint8Array(sealed.iv);
    iv[0] = (iv[0] ?? 0) ^ 1;
    expect(() => decryptSecret(k, ID, { ...sealed, iv })).toThrow();
    expect(() => decryptSecret(k, uid(202), sealed)).toThrow();
    expect(() => decryptSecret(parseMasterKey(MASTER, 2), ID, sealed)).toThrow();
    expect(() => decryptSecret(k, ID, { ...sealed, keyVersion: 2 })).toThrow();
    let msg = "";
    try {
      decryptSecret(parseMasterKey(OTHER), ID, sealed);
    } catch (e) {
      msg = String(e);
    }
    expect(msg).not.toContain(LEAK);
    expect(msg).not.toContain(MASTER);
  });
});
