// ADM-FR-01, ADM-NFR-01 · ký/verify JWT EdDSA, tách aud access/change, cặp khoá lệch.
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import {
  loadJwtKeys,
  signAccessToken,
  signChangeToken,
  signTotpToken,
  verifyAccessToken,
  verifyChangeToken,
  verifyTotpToken,
} from "./jwt";

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "kid-1",
  };
};
const SUB = "01900000-0000-7000-8000-000000000013";
const TID = "01900000-0000-7000-8000-000000000001";
const claims = { sub: SUB, tid: TID, role: "member" as const, sid: SUB };

describe("ADM-FR-01 · jwt", () => {
  test("ADM-FR-01 · access token: header EdDSA+kid, iss/aud, exp-iat=900, verify ra claim", async () => {
    const keys = await loadJwtKeys(pair());
    const t = await signAccessToken(keys, claims);
    expect(decodeProtectedHeader(t)).toEqual({ alg: "EdDSA", kid: "kid-1" });
    const c = decodeJwt(t);
    expect([c.iss, c.aud, (c.exp ?? 0) - (c.iat ?? 0)]).toEqual(["admin", "ai-system", 900]);
    expect(await verifyAccessToken(keys, t)).toEqual(claims);
  });

  test("ADM-FR-06 · change token không dùng làm access token và ngược lại", async () => {
    const keys = await loadJwtKeys(pair());
    const ch = await signChangeToken(keys, { sub: SUB, tid: TID, pwc: 123 });
    const ac = await signAccessToken(keys, claims);
    expect(await verifyAccessToken(keys, ch)).toBeNull();
    expect(await verifyChangeToken(keys, ac)).toBeNull();
    expect(await verifyChangeToken(keys, ch)).toEqual({ sub: SUB, tid: TID, pwc: 123 });
    expect((decodeJwt(ch).exp ?? 0) - (decodeJwt(ch).iat ?? 0)).toBe(300);
  });

  test("ADM-NFR-01 · khoá khác / rác / tid không phải uuid → null", async () => {
    const keys = await loadJwtKeys(pair());
    const other = await loadJwtKeys(pair());
    expect(await verifyAccessToken(keys, await signAccessToken(other, claims))).toBeNull();
    expect(await verifyAccessToken(keys, "rac")).toBeNull();
    const bad = await signAccessToken(keys, { ...claims, tid: "abc" });
    expect(await verifyAccessToken(keys, bad)).toBeNull();
  });

  test("ADM-NFR-01 · cặp khoá lệch → loadJwtKeys ném, không in khoá", async () => {
    const a = pair();
    const b = pair();
    const err = await loadJwtKeys({ ...a, JWT_PUBLIC_KEY: b.JWT_PUBLIC_KEY }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).not.toContain("BEGIN");
  });
});

describe("ADM-FR-08 · totp_token", () => {
  const T = new Date("2026-01-01T00:00:00Z");
  const tc = { sub: SUB, tid: TID, pwc: 11, tte: 22 };

  test("ADM-FR-08 · aud admin:totp, exp-iat=300 theo đồng hồ app; hết hạn sau 300 s", async () => {
    const keys = await loadJwtKeys(pair());
    const t = await signTotpToken(keys, tc, T);
    const c = decodeJwt(t);
    expect([c.aud, c.iat, (c.exp ?? 0) - (c.iat ?? 0)]).toEqual([
      "admin:totp",
      T.getTime() / 1000,
      300,
    ]);
    expect(await verifyTotpToken(keys, t, new Date(T.getTime() + 299_000))).toEqual(tc);
    expect(await verifyTotpToken(keys, t, new Date(T.getTime() + 301_000))).toBeNull();
  });

  test("ADM-FR-08 · không dùng lẫn với access/change token", async () => {
    const keys = await loadJwtKeys(pair());
    const t = await signTotpToken(keys, tc, new Date());
    expect(await verifyChangeToken(keys, t)).toBeNull();
    expect(await verifyAccessToken(keys, t)).toBeNull();
    const ch = await signChangeToken(keys, { sub: SUB, tid: TID, pwc: 1 });
    expect(await verifyTotpToken(keys, ch, new Date())).toBeNull();
  });
});
