// cf-esign-docusign · unit (viết TRƯỚC code): JWT Grant RS256 tự ký đúng định dạng (verify bằng khoá công khai test) + HMAC Connect
// đúng/sai/thiếu khoá.
import { describe, expect, it } from "bun:test";
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { connectHmacOk, docusignJwt } from "./docusign.crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

describe("docusignJwt (JWT Grant RS256)", () => {
  const now = 1_800_000_000;
  const jwt = docusignJwt({
    integrationKey: "ik-123",
    userId: "user-456",
    oauthHost: "account-d.docusign.com",
    privateKeyPem: privateKey,
    nowS: now,
  });
  const [h, p, s] = jwt.split(".");

  it("3 phần base64url; header RS256/JWT; claim iss/sub/aud/scope/iat/exp", () => {
    expect(jwt.split(".")).toHaveLength(3);
    expect(b64urlJson(h as string)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(b64urlJson(p as string)).toEqual({
      iss: "ik-123",
      sub: "user-456",
      aud: "account-d.docusign.com",
      scope: "signature impersonation",
      iat: now,
      exp: now + 3600,
    });
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("chữ ký verify được bằng khoá công khai test; sửa payload ⇒ sai", () => {
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    expect(v.verify(publicKey, Buffer.from(s as string, "base64url"))).toBe(true);
    const v2 = createVerify("RSA-SHA256");
    v2.update(`${h}.${p}x`);
    expect(v2.verify(publicKey, Buffer.from(s as string, "base64url"))).toBe(false);
  });
});

describe("connectHmacOk (X-DocuSign-Signature-*)", () => {
  const key = "connect-secret";
  const body = new TextEncoder().encode(
    '{"event":"envelope-completed","data":{"envelopeId":"e1"}}',
  );
  const sig = createHmac("sha256", key).update(body).digest("base64");

  it("đúng chữ ký (header 1 hoặc 2 khi xoay khoá) ⇒ true", () => {
    expect(connectHmacOk(key, body, [sig])).toBe(true);
    expect(connectHmacOk(key, body, ["AAAA", sig])).toBe(true);
  });
  it("sai chữ ký / sai thân / không header ⇒ false", () => {
    expect(connectHmacOk(key, body, ["bad"])).toBe(false);
    expect(connectHmacOk(key, new TextEncoder().encode("{}"), [sig])).toBe(false);
    expect(connectHmacOk(key, body, [])).toBe(false);
  });
  it("server chưa đặt khoá ⇒ luôn false (từ chối webhook)", () => {
    expect(connectHmacOk(null, body, [sig])).toBe(false);
    expect(connectHmacOk("", body, [sig])).toBe(false);
  });
});
