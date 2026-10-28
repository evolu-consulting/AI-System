// CR-102a · Hub đọc claim `kind`/`xorg` của access token: vắng ⇒ internal (token cũ trước 0028 vẫn dùng được);
// external thiếu/hỏng xorg hay kind lạ ⇒ token hỏng (null).
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { importJwtPublicKey, kindOfClaims, verifyAccessToken } from "./jwt";

const SUB = "01900000-0000-7000-8000-000000000013";
const TID = "01900000-0000-7000-8000-000000000001";
const ORG = "01900000-0000-7000-8000-0000000000aa";

async function setup() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const priv = await importPKCS8(
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    "EdDSA",
  );
  const pub = await importJwtPublicKey(
    publicKey.export({ type: "spki", format: "pem" }).toString(),
  );
  const sign = (extra: Record<string, unknown>) =>
    new SignJWT({ tid: TID, role: "member", sid: null, ...extra })
      .setProtectedHeader({ alg: "EdDSA", kid: "k" })
      .setSubject(SUB)
      .setIssuer("admin")
      .setAudience("ai-system")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(priv);
  return { pub, sign };
}

describe("CR-102a · hub verifyAccessToken + kind", () => {
  test("token cũ không claim ⇒ internal; external + xorg ⇒ external", async () => {
    const { pub, sign } = await setup();
    expect(await verifyAccessToken(pub, await sign({}))).toMatchObject({
      kind: "internal",
      extOrgId: null,
    });
    expect(await verifyAccessToken(pub, await sign({ kind: "external", xorg: ORG }))).toMatchObject(
      {
        kind: "external",
        extOrgId: ORG,
      },
    );
  });

  test("claim hỏng ⇒ null", async () => {
    const { pub, sign } = await setup();
    expect(await verifyAccessToken(pub, await sign({ kind: "external" }))).toBeNull();
    expect(await verifyAccessToken(pub, await sign({ kind: "admin" }))).toBeNull();
    expect(await verifyAccessToken(pub, await sign({ xorg: ORG }))).toBeNull();
    expect(kindOfClaims({ kind: "external", xorg: "x" })).toBeNull();
  });
});
