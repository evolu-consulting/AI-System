// ADM-FR-01, ADM-BR-05, ADM-BR-09 · requireAuth/requireRole + scope theo role trong DB (plan M1 §5 "Middleware").
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import { Hono } from "hono";
import postgres from "postgres";
import { type AppVars, requireAuth, requireRole } from "./auth-middleware";
import { AppError, toErrorBody } from "./errors";
import { type JwtKeys, loadJwtKeys, signAccessToken } from "./jwt";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const PLATFORM = "01900000-0000-7000-8000-00000000d001";
const ACME = "01900000-0000-7000-8000-00000000d002";
const ROOT = "01900000-0000-7000-8000-00000000d011";
const MEM = "01900000-0000-7000-8000-00000000d012";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 2 });
let keys: JwtKeys;
let app: Hono<AppVars>;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${PLATFORM}, 'platform', 'P'), (${ACME}, 'acme', 'A')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${ROOT}, ${PLATFORM}, 'root', 'h', 'R', 'platform_admin'),
           (${MEM}, ${ACME}, 'mem', 'h', 'M', 'member')`;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "mw",
  });
  app = new Hono<AppVars>();
  app.onError((e, c) =>
    e instanceof AppError ? c.json(toErrorBody(e.code, e.message), e.status) : c.text("x", 500),
  );
  app.use(requireAuth({ db, keys }));
  app.get("/scope", (c) => c.json(c.get("scope")));
  app.get("/platform", requireRole("platform_admin"), (c) => c.text("ok"));
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

const tok = (sub: string, tid: string, role: "platform_admin" | "member") =>
  signAccessToken(keys, { sub, tid, role, sid: null });
const get = async (path: string, t?: string) =>
  app.request(path, { headers: t ? { authorization: `Bearer ${t}` } : {} });

describe("ADM-BR-09 · requireAuth", () => {
  test("ADM-BR-09 · platform_admin của tenant platform → scope platform; member → scope tenant", async () => {
    expect(await (await get("/scope", await tok(ROOT, PLATFORM, "platform_admin"))).json()).toEqual(
      {
        kind: "platform",
      },
    );
    expect(await (await get("/scope", await tok(MEM, ACME, "member"))).json()).toEqual({
      kind: "tenant",
      tenantId: ACME,
    });
  });

  test("ADM-BR-05 · claim role giả không mở quyền; sai tid → 401; thiếu token → 401", async () => {
    const forged = await tok(MEM, ACME, "platform_admin");
    expect((await get("/platform", forged)).status).toBe(403);
    expect((await get("/scope", await tok(MEM, PLATFORM, "member"))).status).toBe(401);
    expect((await get("/scope")).status).toBe(401);
    expect((await get("/platform", await tok(ROOT, PLATFORM, "platform_admin"))).status).toBe(200);
  });
});
