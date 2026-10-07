// HUB-FR-01, HUB-FR-74, HUB-FR-88 · unit: test vector Admin → Hub (khoá cố định) + middleware 401 / gắn user, log.
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { createApp } from "../app";
import type { ConfigCache } from "../modules/config/config.service";
import { type AuthUser, type AuthVars, requireAuth } from "./auth.middleware";
import { mapError } from "./errors";
import { importJwtPublicKey, verifyAccessToken } from "./jwt";
import { logger, setSink } from "./logger";

// Test vector cố định: khoá công khai Ed25519 RFC 8037 §A.1 + token ký bằng khoá riêng tương ứng theo dạng
// `signAccessToken` của Admin (header {alg:EdDSA,kid:k1}, iss admin, aud ai-system, exp 4102444800 = năm 2100).
const PUB_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=
-----END PUBLIC KEY-----`;
const VECTOR =
  "eyJhbGciOiJFZERTQSIsImtpZCI6ImsxIn0.eyJ0aWQiOiJhMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoibWVtYmVyIiwic2lkIjoiZmFtLTEiLCJzdWIiOiJhMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwYTEiLCJpc3MiOiJhZG1pbiIsImF1ZCI6ImFpLXN5c3RlbSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.ue8iA7Qa9v1x-DqzayptR-Q_YnvnTK-Fne0GqbUNMfvFSB8Yy1h7RuLFXWe70Tdgx5uBdUElBOdFnq3c1XosAA";
const SUB = "a0000000-0000-4000-8000-0000000000a1";
const TID = "a0000000-0000-4000-8000-000000000001";
const cfg = { version: "0.0.0", corsOrigins: [] };

let key: CryptoKey;
let priv: CryptoKey;
let pub: CryptoKey;

beforeAll(async () => {
  key = await importJwtPublicKey(PUB_PEM);
  ({ privateKey: priv, publicKey: pub } = await generateKeyPair("EdDSA"));
});

function token(claims: Record<string, unknown> = { tid: TID, role: "member" }, expS = 600) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", kid: "t" })
    .setSubject(SUB)
    .setIssuer("admin")
    .setAudience("ai-system")
    .setIssuedAt(now)
    .setExpirationTime(now + expS)
    .sign(priv);
}

describe("HUB-FR-74 · verifyAccessToken", () => {
  test("HUB-FR-74 · test vector cố định (khoá RFC 8037) verify ra đúng claims", async () => {
    expect(await verifyAccessToken(key, VECTOR)).toMatchObject({
      sub: SUB,
      tid: TID,
      role: "member",
      sid: "fam-1",
    });
  });

  test("HUB-FR-01 · đổi một byte payload → null; sid vắng → null trong claims", async () => {
    expect(await verifyAccessToken(key, VECTOR.replace("eyJ0aWQ", "eyJ0aWR"))).toBeNull();
    const c = await verifyAccessToken(pub, await token());
    expect(c?.sid).toBeNull();
  });
});

type Usable = boolean | "no-cache";

/** App tối giản: middleware đặt `log` + `config` giả (như app.ts) rồi `requireAuth`; route ghi lại `user` và log một dòng. */
async function call(usable: Usable, authorization?: string) {
  const fake = { accountUsable: async () => usable === true } as unknown as ConfigCache;
  const app = new Hono<AuthVars>();
  const seen: AuthUser[] = [];
  app.use(async (c, next) => {
    c.set("log", logger.child({ request_id: "r1" }));
    if (usable !== "no-cache") c.set("config", fake);
    await next();
  });
  app.use("/p/*", requireAuth(pub));
  app.get("/p/x", (c) => {
    seen.push(c.var.user);
    c.var.log.warn("probe");
    return c.text("ok");
  });
  app.onError((err, c) => c.json(mapError(err).body, mapError(err).status));
  const res = await app.request("/p/x", authorization ? { headers: { authorization } } : {});
  return { status: res.status, body: await res.text(), seen };
}

const AUTH_EXPIRED = JSON.stringify({
  error: { code: "AUTH_EXPIRED", message: "Session expired" },
});

describe("HUB-FR-88 · requireAuth", () => {
  test("HUB-FR-01 · thiếu / hỏng / hết hạn / không phải Bearer → 401 AUTH_EXPIRED", async () => {
    const expired = `Bearer ${await token(undefined, -60)}`;
    for (const a of [undefined, "Bearer x.y.z", "Bearer ", expired, `Basic ${await token()}`]) {
      expect(await call(true, a)).toMatchObject({ status: 401, body: AUTH_EXPIRED });
    }
  });

  test("HUB-FR-88 · tài khoản khoá theo cache, hoặc không có cache → 401", async () => {
    const t = `Bearer ${await token()}`;
    expect(await call(false, t)).toMatchObject({ status: 401, body: AUTH_EXPIRED });
    expect(await call("no-cache", t)).toMatchObject({ status: 401, body: AUTH_EXPIRED });
  });

  test("HUB-FR-01 · hợp lệ → gắn user + log child có tenant_id, user_id", async () => {
    const lines: string[] = [];
    const restore = setSink((_l, line) => lines.push(line));
    try {
      const r = await call(true, `Bearer ${await token({ tid: TID, role: "tenant_admin" })}`);
      expect(r.status).toBe(200);
      expect(r.seen).toMatchObject([{ userId: SUB, tenantId: TID, role: "tenant_admin" }]);
      expect(typeof r.seen[0]?.exp).toBe("number");
      const line = lines.find((l) => l.includes("probe")) ?? "";
      expect(line).toContain(`"tenant_id":"${TID}"`);
      expect(line).toContain(`"user_id":"${SUB}"`);
    } finally {
      restore();
    }
  });
});

describe("HUB-FR-01 · createApp chặn gốc route cần JWT", () => {
  test("HUB-FR-01 · /conversations, /runs/:id không token → 401; /health và route lạ không chặn", async () => {
    const app = createApp(cfg, { jwtPublicKey: pub });
    for (const p of ["/conversations", "/conversations/abc/messages", "/runs/abc"]) {
      const res = await app.request(p);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("AUTH_EXPIRED");
    }
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/nope")).status).toBe(404);
  });

  test("HUB-FR-88 · createApp không có db (không cache) → token hợp lệ vẫn 401", async () => {
    const app = createApp(cfg, { jwtPublicKey: pub });
    const res = await app.request("/conversations", {
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(res.status).toBe(401);
  });
});
