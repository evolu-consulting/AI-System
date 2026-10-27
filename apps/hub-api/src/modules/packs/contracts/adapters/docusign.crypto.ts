// cf-esign-docusign · mật mã DocuSign bằng `node:crypto` (không thêm thư viện): JWT Grant RS256 tự ký + kiểm HMAC-SHA256 của Connect.
// Không log khoá/token.
import { createHmac, createSign, timingSafeEqual } from "node:crypto";

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** JWT assertion cho `POST https://<oauthHost>/oauth/token` (grant `jwt-bearer`), sống 1 giờ. */
export function docusignJwt(o: {
  integrationKey: string;
  userId: string;
  oauthHost: string;
  privateKeyPem: string;
  nowS: number;
}): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({
      iss: o.integrationKey,
      sub: o.userId,
      aud: o.oauthHost,
      scope: "signature impersonation",
      iat: o.nowS,
      exp: o.nowS + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${b64url(signer.sign(o.privateKeyPem))}`;
}

/** HMAC Connect: base64(HMAC-SHA256(key, thân thô)) khớp MỘT trong các header `X-DocuSign-Signature-n`. Không khoá ⇒ false. */
export function connectHmacOk(
  key: string | null,
  rawBody: Uint8Array,
  signatures: readonly string[],
): boolean {
  if (!key) return false;
  const want = createHmac("sha256", key).update(rawBody).digest();
  return signatures.some((s) => {
    const got = Buffer.from(s.trim(), "base64");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
