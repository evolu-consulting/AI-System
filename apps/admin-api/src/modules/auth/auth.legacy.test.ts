// N5B-FR-02, N5B-NFR-01 · verify scrypt legacy (vector RFC 7914 + vector Python của mgmt-app) và thời gian ngang nhau.
import { beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@ai/db";
import { scryptVerify, type VerifyPrims, verifyLogin } from "./auth.legacy";
import { parseLegacyHash } from "./auth.legacy.rules";

/** RFC 7914 §12: P="pleaseletmein", S="SodiumChloride", N=16384, r=8, p=1, dkLen=64. */
const RFC_SALT = Buffer.from("SodiumChloride").toString("hex");
const RFC_DK =
  "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2" +
  "d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887";
const RFC = `$scrypt-legacy$ln=14,r=8,p=1$${RFC_SALT}$${RFC_DK}`;
/** `hashlib.scrypt("bí mật 123".encode(), salt=bytes.fromhex(SALT), n=2**14, r=8, p=1)` — đúng auth.py mgmt-app. */
const MGMT_PW = "bí mật 123";
const MGMT_HASH =
  "scrypt$00112233445566778899aabbccddeeff$" +
  "89dfac31c7b8af82a758ec98fdbf0505a8091293ae8613a019f69f85300419ba" +
  "5e62dcbff56e3be6fb74f27bff7d97b0413126355726a7d4b539e475617504a5";
const MGMT_LEGACY = `$scrypt-legacy$ln=14,r=8,p=1$${MGMT_HASH.slice(7)}`;

let argon = "";
let dummy = "";
beforeAll(async () => {
  argon = await hashPassword("Argon-Passw0rd");
  dummy = await hashPassword("dummy");
});

const parsed = (h: string) => {
  const p = parseLegacyHash(h);
  if (!p) throw new Error("vector không parse được");
  return p;
};

describe("N5B-FR-02 · scryptVerify", () => {
  test("N5B-FR-02 · vector RFC 7914 (N=16384,r=8,p=1) ⇒ đúng; sai một ký tự ⇒ sai", async () => {
    expect(await scryptVerify("pleaseletmein", parsed(RFC))).toBe(true);
    expect(await scryptVerify("pleaseletmeim", parsed(RFC))).toBe(false);
  });
  test("N5B-FR-02 · vector mgmt-app (Python hashlib, mật khẩu có dấu UTF-8) ⇒ đúng", async () => {
    expect(await scryptVerify(MGMT_PW, parsed(MGMT_LEGACY))).toBe(true);
    expect(await scryptVerify("bi mat 123", parsed(MGMT_LEGACY))).toBe(false);
    expect(await scryptVerify("", parsed(MGMT_LEGACY))).toBe(false);
  });
});

describe("N5B-FR-02, N5B-FR-04 · verifyLogin", () => {
  const on = () => ({ dummyHash: dummy, legacyOn: true });
  test("N5B-FR-02 · legacy đúng ⇒ ok + rehash argon2id của đúng mật khẩu; sai ⇒ không ok, không rehash", async () => {
    const r = await verifyLogin(MGMT_PW, MGMT_LEGACY, on());
    expect(r.ok).toBe(true);
    expect(r.rehash?.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(await Bun.password.verify(MGMT_PW, r.rehash as string)).toBe(true);
    expect(await verifyLogin("sai", MGMT_LEGACY, on())).toEqual({ ok: false, rehash: null });
  });
  test("N5B-FR-02 · argon2 vẫn như cũ; user không tồn tại ⇒ không ok", async () => {
    expect(await verifyLogin("Argon-Passw0rd", argon, on())).toEqual({ ok: true, rehash: null });
    expect(await verifyLogin("x", argon, on())).toEqual({ ok: false, rehash: null });
    expect(await verifyLogin("x", null, on())).toEqual({ ok: false, rehash: null });
    expect(await verifyLogin("dummy", null, on())).toEqual({ ok: false, rehash: null });
  });
  test("N5B-FR-02 · vượt trần (ln=18) ⇒ không ok, không chạy scrypt thật với tham số đó", async () => {
    const big = `$scrypt-legacy$ln=18,r=8,p=1$${MGMT_HASH.slice(7)}`;
    expect((await verifyLogin(MGMT_PW, big, on())).ok).toBe(false);
  });
  test("N5B-FR-04 · sau sunset ⇒ legacy đúng mật khẩu vẫn không ok", async () => {
    const r = await verifyLogin(MGMT_PW, MGMT_LEGACY, { dummyHash: dummy, legacyOn: false });
    expect(r.ok).toBe(false);
  });
});

describe("N5B-NFR-01 · cùng khối lượng việc, thời gian ngang nhau", () => {
  function counting() {
    const n = { argon: [] as string[], scrypt: [] as number[] };
    const prims: VerifyPrims = {
      argon2: async (_pw, h) => {
        n.argon.push(h === dummy ? "dummy" : "real");
        return false;
      },
      scrypt: async (_pw, p) => {
        n.scrypt.push(p.N);
        return false;
      },
      hash: async () => {
        n.argon.push("hash");
        return "$argon2id$x";
      },
    };
    return { n, prims };
  }

  test("N5B-NFR-01 · trước sunset: mỗi đường đúng 1 phép argon2 (verify/hash) + 1 scrypt N=16384", async () => {
    for (const stored of [null, argon, MGMT_LEGACY, "$scrypt-legacy$ln=18,r=8,p=1$00$00"]) {
      const { n, prims } = counting();
      await verifyLogin("pw", stored, { dummyHash: dummy, legacyOn: true, prims });
      expect(n.argon.length).toBe(1);
      expect(n.scrypt).toEqual([16384]);
    }
  });
  test("N5B-NFR-01 · sau sunset: mỗi đường đúng 1 argon2, 0 scrypt", async () => {
    for (const stored of [null, argon, MGMT_LEGACY]) {
      const { n, prims } = counting();
      await verifyLogin("pw", stored, { dummyHash: dummy, legacyOn: false, prims });
      expect(n.argon.length).toBe(1);
      expect(n.scrypt.length).toBe(0);
    }
  });
});

describe("N5B-NFR-01 · thời gian thật", () => {
  test("N5B-NFR-01 · trung vị thời gian thật 3 đường (không tồn tại / argon2 / legacy) lệch < 35 %", async () => {
    const o = { dummyHash: dummy, legacyOn: true };
    const median = async (stored: string | null) => {
      const xs: number[] = [];
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        await verifyLogin("wrong-password", stored, o);
        xs.push(performance.now() - t0);
      }
      return xs.sort((a, b) => a - b)[3] as number;
    };
    await median(null); // làm nóng
    const ms = [await median(null), await median(argon), await median(MGMT_LEGACY)];
    expect(Math.max(...ms) / Math.min(...ms)).toBeLessThan(1.35);
  }, 20_000);
});
