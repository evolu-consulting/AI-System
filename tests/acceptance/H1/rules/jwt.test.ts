// HUB-FR-01, 74 · HUB-H1-AC-09 · H1-R02 · verifyAccessToken của Hub (test-plan H1 §4 R11–R13; plan §6.4).
import { beforeAll, describe, expect, it } from "bun:test";
import { ROLES, type Role } from "@ai/contracts";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { type JwtKeys, signAccessToken } from "../../../../apps/admin-api/src/lib/jwt";
import { verifyAccessToken } from "../../../../apps/hub-api/src/lib/jwt";

const SUB = "a0000000-0000-4000-8000-0000000000a1";
const TID = "a0000000-0000-4000-8000-000000000001";

let keys: JwtKeys;
let other: CryptoKey;
let publicPem: string;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  keys = { privateKey: pair.privateKey, publicKey: pair.publicKey, kid: "test-1" };
  other = (await generateKeyPair("EdDSA")).privateKey;
  publicPem = await exportSPKI(pair.publicKey);
});

type Opts = {
  claims?: Record<string, unknown>;
  sub?: string | null;
  iss?: string;
  aud?: string;
  expS?: number;
  key?: CryptoKey;
};

function sign(o: Opts = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT(o.claims ?? { tid: TID, role: "member", sid: null })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-1" })
    .setIssuer(o.iss ?? "admin")
    .setAudience(o.aud ?? "ai-system")
    .setIssuedAt(now - 60)
    .setExpirationTime(now + (o.expS ?? 600));
  if (o.sub !== null) jwt.setSubject(o.sub ?? SUB);
  return jwt.sign(o.key ?? keys.privateKey);
}

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");
const expectNull = async (token: string) =>
  expect(await verifyAccessToken(keys.publicKey, token)).toBeNull();

describe("R11 · verifyAccessToken hợp lệ [HUB-FR-01 · H1-R02]", () => {
  it("R11 · token EdDSA đúng iss/aud/sub/tid/role → claims, đủ 3 role [HUB-FR-01 · HUB-H1-AC-09]", async () => {
    for (const role of ROLES) {
      const token = await sign({ claims: { tid: TID, role, sid: "s-1" } });
      expect(await verifyAccessToken(keys.publicKey, token)).toMatchObject({
        sub: SUB,
        tid: TID,
        role,
      });
    }
  });
});

describe("R12 · verifyAccessToken sai → null [HUB-FR-01 · H1-R02]", () => {
  it("R12 · ký bằng khoá khác → null [H1-R02]", async () => {
    await expectNull(await sign({ key: other }));
  });

  it("R12 · alg none → null [H1-R02]", async () => {
    const payload = { iss: "admin", aud: "ai-system", sub: SUB, tid: TID, role: "member" };
    await expectNull(`${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`);
  });

  it("R12 · HS256 ký bằng PEM công khai (nhầm thuật toán) → null [H1-R02]", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ tid: TID, role: "member" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(SUB)
      .setIssuer("admin")
      .setAudience("ai-system")
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(new TextEncoder().encode(publicPem));
    await expectNull(token);
  });

  it("R12 · hết hạn → null [H1-R02]", async () => {
    await expectNull(await sign({ expS: -120 }));
  });

  it("R12 · aud hoặc iss sai → null [H1-R02]", async () => {
    await expectNull(await sign({ aud: "admin:password-change" }));
    await expectNull(await sign({ iss: "hub" }));
  });

  it("R12 · sub không phải uuid hoặc thiếu → null [H1-R02]", async () => {
    await expectNull(await sign({ sub: "lan" }));
    await expectNull(await sign({ sub: null }));
  });

  it("R12 · thiếu tid hoặc tid không phải uuid → null [H1-R02]", async () => {
    await expectNull(await sign({ claims: { role: "member" } }));
    await expectNull(await sign({ claims: { tid: "acme", role: "member" } }));
  });

  it("R12 · role ngoài enum hoặc thiếu → null [H1-R02]", async () => {
    await expectNull(await sign({ claims: { tid: TID, role: "root" } }));
    await expectNull(await sign({ claims: { tid: TID } }));
  });

  it("R12 · token rác / 3 phần rỗng → null [H1-R02]", async () => {
    for (const t of ["", "rac", "a.b.c", ".."]) await expectNull(t);
  });
});

describe("R13 · test vector Admin → Hub [HUB-FR-74 · HUB-H1-AC-09]", () => {
  it("R13 · token do signAccessToken (Admin) sinh verify được ở Hub [HUB-FR-74 · HUB-H1-AC-09]", async () => {
    const role: Role = "tenant_admin";
    const token = await signAccessToken(keys, { sub: SUB, tid: TID, role, sid: "s-1" });
    expect(await verifyAccessToken(keys.publicKey, token)).toMatchObject({
      sub: SUB,
      tid: TID,
      role,
    });
  });
});
