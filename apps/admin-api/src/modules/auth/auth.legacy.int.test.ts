// N5B-FR-02, N5B-FR-03, N5B-FR-04, N5B-FR-05, N5B-NFR-02 · đăng nhập user mgmt-app bằng mật khẩu cũ (scrypt legacy)
// trên DB thật qua role admin_api (RLS). Hash legacy dựng bằng chính `importableHash` của importer (round-trip N5 → login).
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import * as dbm from "@ai/db";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import { loadJwtKeys } from "../../lib/jwt";
import { importableHash } from "../identity-import/domain/import.rules";
import { type AuthCtx, createDummyHash, login } from "./auth.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TA = "01900000-0000-7000-8000-00000000b501";
const TB = "01900000-0000-7000-8000-00000000b502";
const UA = "01900000-0000-7000-8000-00000000b511";
const UB = "01900000-0000-7000-8000-00000000b512";
/** Vector Python `hashlib.scrypt` đúng auth.py mgmt-app (spec N5b §7 R2). */
const PW = "bí mật 123";
const MGMT =
  "scrypt$00112233445566778899aabbccddeeff$" +
  "89dfac31c7b8af82a758ec98fdbf0505a8091293ae8613a019f69f85300419ba" +
  "5e62dcbff56e3be6fb74f27bff7d97b0413126355726a7d4b539e475617504a5";
const LEGACY = importableHash(MGMT) as string;
/** Hash legacy của tenant B: cùng username, mật khẩu khác ("pleaseletmein", vector RFC 7914). */
const LEGACY_B =
  `$scrypt-legacy$ln=14,r=8,p=1$${Buffer.from("SodiumChloride").toString("hex")}$` +
  "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2" +
  "d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887";
const WEB = { client: "web" as const, userAgent: "bun-test" };
const SUNSET = new Date("2027-04-19T00:00:00.000Z");

const owner = postgres(OWNER, { max: 2, onnotice: () => {} });
const db = createDb(API, { max: 6 });
let ctx: AuthCtx;
let clock = new Date("2026-10-20T09:00:00.000Z");
/** audit_log append-only (không truncate được) ⇒ mỗi test chỉ đọc hàng sau mốc seq. */
let seq0 = 0;

const code = async (p: Promise<unknown>) => {
  try {
    const r = (await p) as { kind: string };
    return r.kind;
  } catch (e) {
    return isAppError(e) ? e.code : String(e);
  }
};
const signIn = (tenant: string, pw = PW) =>
  code(login(ctx, { tenant_key: tenant, username: "leg", password: pw }, WEB));

type Row = { h: string; v: number; pwc: Date; must: boolean; failed: number };
const userRow = async (id: string) =>
  (
    await owner<Row[]>`select password_hash as h, version as v, password_changed_at as pwc,
      must_change_password as must, failed_logins as failed from admin.users where id = ${id}`
  )[0] as Row;
const rehashAudits = () =>
  owner<{ tenant_id: string; actor_id: string; entity_id: string; action: string; blob: string }[]>`
    select tenant_id, actor_id, entity_id, action,
      coalesce(before::text, '') || coalesce(after::text, '') || summary::text as blob
    from admin.audit_log where summary->>'op' = 'legacy_rehash' and seq > ${seq0} order by seq`;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "n5b",
  });
  ctx = { db, keys, now: () => clock, dummyHash: await createDummyHash(), legacySunset: SUNSET };
});
beforeEach(async () => {
  clock = new Date("2026-10-20T09:00:00.000Z");
  const [m] = await owner<
    { s: number }[]
  >`select coalesce(max(seq), 0)::int as s from admin.audit_log`;
  seq0 = m?.s ?? 0;
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TA}, 'ta', 'A'), (${TB}, 'tb', 'B')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, must_change_password)
    values (${UA}, ${TA}, 'leg', ${LEGACY}, 'Leg A', 'member', false),
           (${UB}, ${TB}, 'leg', ${LEGACY_B}, 'Leg B', 'member', false)`;
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("N5B-FR-02, N5B-FR-03 · login legacy ⇒ phiên + rehash argon2id một lần", () => {
  test("N5B-FR-03 · mật khẩu cũ ⇒ session; hash thành argon2id; version, password_changed_at giữ; 1 audit không hash", async () => {
    const before = await userRow(UA);
    expect(await signIn("ta")).toBe("session");
    const after = await userRow(UA);
    expect(after.h.startsWith("$argon2id$")).toBe(true);
    expect(await Bun.password.verify(PW, after.h)).toBe(true);
    expect(after.v).toBe(before.v);
    expect(after.pwc.getTime()).toBe(before.pwc.getTime());
    const au = await rehashAudits();
    expect(au.map((a) => [a.tenant_id, a.actor_id, a.entity_id, a.action])).toEqual([
      [TA, UA, UA, "update"],
    ]);
    for (const s of ["scrypt", "argon2", "password", "89dfac31"])
      expect(au[0]?.blob).not.toContain(s);
    // Lần sau: argon2 thường, không audit thêm.
    expect(await signIn("ta")).toBe("session");
    expect((await rehashAudits()).length).toBe(1);
  });
});

describe("N5B-FR-02, N5B-FR-04, N5B-FR-05 · từ chối và chuỗi bước", () => {
  test("N5B-FR-02 · sai mật khẩu ⇒ INVALID_CREDENTIALS, đếm sai +1, hash legacy giữ, không audit", async () => {
    expect(await signIn("ta", "bi mat 123")).toBe("INVALID_CREDENTIALS");
    const r = await userRow(UA);
    expect(r.h).toBe(LEGACY);
    expect(r.failed).toBe(1);
    expect((await rehashAudits()).length).toBe(0);
  });

  test("N5B-FR-02 · hash legacy vượt trần (ln=18) ⇒ INVALID_CREDENTIALS dù mật khẩu đúng", async () => {
    const big = LEGACY.replace("ln=14", "ln=18");
    await owner`update admin.users set password_hash = ${big} where id = ${UA}`;
    expect(await signIn("ta")).toBe("INVALID_CREDENTIALS");
    expect((await userRow(UA)).h).toBe(big);
  });

  test("N5B-FR-04 · sau sunset ⇒ INVALID_CREDENTIALS, hash legacy giữ (đường đặt lại)", async () => {
    clock = SUNSET;
    expect(await signIn("ta")).toBe("INVALID_CREDENTIALS");
    expect((await userRow(UA)).h).toBe(LEGACY);
  });
});

describe("N5B-FR-03 · một lần, nguyên tử", () => {
  test("N5B-FR-03 · hai login song song ⇒ cả hai session, đúng một rehash + một audit", async () => {
    const rs = await Promise.all([signIn("ta"), signIn("ta"), signIn("ta")]);
    expect(rs).toEqual(["session", "session", "session"]);
    expect((await userRow(UA)).h.startsWith("$argon2id$")).toBe(true);
    expect((await rehashAudits()).length).toBe(1);
  });

  test("N5B-FR-03 · audit lỗi ⇒ cả tx rollback: không phiên, hash legacy giữ", async () => {
    const spy = spyOn(dbm, "insertAuditRows").mockImplementation(async () => {
      throw new Error("boom");
    });
    try {
      expect(await signIn("ta")).toContain("boom");
    } finally {
      spy.mockRestore();
    }
    expect((await userRow(UA)).h).toBe(LEGACY);
    const [n] = await owner<{ n: number }[]>`select count(*)::int as n from admin.refresh_tokens`;
    expect(n?.n).toBe(0);
  });
});

describe("N5B-FR-05 · chuỗi bước sau mật khẩu", () => {
  test("N5B-FR-05 · must_change_password vẫn đi bước password_change_required, và vẫn rehash", async () => {
    await owner`update admin.users set must_change_password = true where id = ${UA}`;
    expect(await signIn("ta")).toBe("change");
    expect((await userRow(UA)).h.startsWith("$argon2id$")).toBe(true);
  });

  test("N5B-FR-05 · user bị khoá ⇒ ACCOUNT_LOCKED, không rehash (readiness R6)", async () => {
    await owner`update admin.users set active = false where id = ${UA}`;
    expect(await signIn("ta")).toBe("ACCOUNT_LOCKED");
    expect((await userRow(UA)).h).toBe(LEGACY);
  });
});

describe("N5B-FR-03 · cách ly tenant", () => {
  test("N5B-FR-03 · cùng username ở tenant B: login A chỉ rehash A; mật khẩu A không mở B", async () => {
    expect(await signIn("ta")).toBe("session");
    expect((await userRow(UB)).h).toBe(LEGACY_B);
    expect(await signIn("tb")).toBe("INVALID_CREDENTIALS");
    expect(await signIn("tb", "pleaseletmein")).toBe("session");
    const au = await rehashAudits();
    expect(au.map((a) => [a.tenant_id, a.entity_id])).toEqual([
      [TA, UA],
      [TB, UB],
    ]);
  });
});
