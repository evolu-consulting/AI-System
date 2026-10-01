// ADM-FR-01, ADM-FR-02, ADM-FR-03, ADM-FR-06, ADM-FR-07 · auth.service trên DB thật qua role admin_api (plan M1 §8).
// Chỉ phủ đổi mật khẩu bắt buộc; tự đổi kiểm ở T5 (cần middleware).
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import * as dbm from "@ai/db";
import { createDb, hashPassword, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import { loadJwtKeys } from "../../lib/jwt";
import {
  type AuthCtx,
  changePasswordForced,
  createDummyHash,
  login,
  logout,
  refresh,
} from "./auth.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-00000000c001";
const AN = "01900000-0000-7000-8000-00000000c011";
const DUNG = "01900000-0000-7000-8000-00000000c012";
const PW = "Svc-Passw0rd-1";
const WEB = { client: "web" as const, userAgent: "bun-test" };
const owner = postgres(OWNER, { max: 2, onnotice: () => {} });
const db = createDb(API, { max: 6 });
let ctx: AuthCtx;
let clock = new Date("2026-10-01T09:00:00.000Z");
let hash = "";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return isAppError(e) ? e.code : String(e);
  }
};

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "svc",
  });
  hash = await hashPassword(PW);
  ctx = { db, keys, now: () => clock, dummyHash: await createDummyHash() };
});
beforeEach(async () => {
  clock = new Date("2026-10-01T09:00:00.000Z");
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'acme', 'Acme')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, must_change_password)
    values (${AN}, ${TID}, 'an', ${hash}, 'An', 'member', false),
           (${DUNG}, ${TID}, 'dung', ${hash}, 'Dung', 'member', true)`;
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

const signIn = () => login(ctx, { tenant_key: "acme", username: "an", password: PW }, WEB);

describe("ADM-FR-01 · login", () => {
  test("ADM-FR-01 · tenant/user không có → verify giả rồi INVALID_CREDENTIALS", async () => {
    const spy = spyOn(dbm, "verifyPassword");
    try {
      const r = await code(login(ctx, { tenant_key: "nope", username: "an", password: PW }, WEB));
      expect(r).toBe("INVALID_CREDENTIALS");
      expect(await code(login(ctx, { tenant_key: "acme", username: "x", password: PW }, WEB))).toBe(
        "INVALID_CREDENTIALS",
      );
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  test("ADM-FR-07 · 5 lần sai song song không vượt quá: khoá đúng một lần, đếm về 0", async () => {
    const bad = { tenant_key: "acme", username: "an", password: "Wrong-Passw0rd-1" };
    const r = await Promise.all(Array.from({ length: 5 }, () => code(login(ctx, bad, WEB))));
    expect(r).toEqual(Array(5).fill("INVALID_CREDENTIALS"));
    const [u] = await owner`select failed_logins, locked_until from admin.users where id = ${AN}`;
    expect(u?.failed_logins).toBe(0);
    expect(new Date(u?.locked_until).toISOString()).toBe("2026-10-01T09:15:00.000Z");
    expect(await code(signIn())).toBe("TEMP_LOCKED");
  });

  test("ADM-FR-06 · must_change_password → change; đổi xong token cũ dùng lại → INVALID_CHANGE_TOKEN", async () => {
    const r = await login(ctx, { tenant_key: "acme", username: "dung", password: PW }, WEB);
    expect(r.kind).toBe("change");
    if (r.kind !== "change") return;
    const input = { change_token: r.body.change_token, new_password: "New-Passw0rd-9" };
    expect(await code(changePasswordForced(ctx, { ...input, new_password: PW }, WEB))).toBe(
      "PASSWORD_UNCHANGED",
    );
    const both = await Promise.all([1, 2].map(() => code(changePasswordForced(ctx, input, WEB))));
    expect(both.sort()).toEqual(["INVALID_CHANGE_TOKEN", "ok"]);
    const [u] =
      await owner`select must_change_password, version from admin.users where id = ${DUNG}`;
    expect(u).toEqual({ must_change_password: false, version: 2 });
  });
});

describe("ADM-FR-02 · refresh / ADM-FR-03 · logout", () => {
  test("ADM-FR-02 · xoay: cũ rotated+replaced_by; dùng lại ngay → SUPERSEDED; lùi 11 s → reuse cả chuỗi", async () => {
    const s = await signIn();
    if (s.kind !== "session") throw new Error("expected session");
    const next = await refresh(ctx, s.refreshToken, WEB);
    expect(await code(refresh(ctx, s.refreshToken, WEB))).toBe("REFRESH_SUPERSEDED");
    await owner`update admin.refresh_tokens set revoked_at = revoked_at - interval '11 seconds'
      where revoked_reason = 'rotated'`;
    expect(await code(refresh(ctx, s.refreshToken, WEB))).toBe("INVALID_REFRESH_TOKEN");
    expect(await code(refresh(ctx, next.refreshToken, WEB))).toBe("INVALID_REFRESH_TOKEN");
    const rows = await owner`select revoked_reason from admin.refresh_tokens order by created_at`;
    expect(rows.map((x) => x.revoked_reason)).toEqual(["rotated", "reuse"]);
  });

  test("ADM-FR-02 · 4 refresh song song → đúng 1 thắng", async () => {
    const s = await signIn();
    if (s.kind !== "session") throw new Error("expected session");
    const r = await Promise.all([1, 2, 3, 4].map(() => code(refresh(ctx, s.refreshToken, WEB))));
    expect(r.filter((x) => x === "ok")).toHaveLength(1);
    expect(r.filter((x) => x === "REFRESH_SUPERSEDED")).toHaveLength(3);
  });

  test("ADM-FR-03 · logout idempotent; refresh sau logout → INVALID_REFRESH_TOKEN", async () => {
    const s = await signIn();
    if (s.kind !== "session") throw new Error("expected session");
    await logout(ctx, s.refreshToken);
    await logout(ctx, s.refreshToken);
    await logout(ctx, "khong-co");
    await logout(ctx, undefined);
    expect(await code(refresh(ctx, s.refreshToken, WEB))).toBe("INVALID_REFRESH_TOKEN");
  });
});

describe("ADM-FR-07 · review vòng 1 #3 · race khoá tạm", () => {
  test("ADM-FR-07 · ảnh chụp chưa khoá, nhưng 5 lần sai chen vào trước khi verify → lần đúng nhận TEMP_LOCKED, không cấp phiên", async () => {
    const bad = { tenant_key: "acme", username: "an", password: "Wrong-Passw0rd-1" };
    const racing: AuthCtx = {
      ...ctx,
      beforeVerify: async () => {
        for (let i = 0; i < 5; i++) await code(login(ctx, bad, WEB));
      },
    };
    const r = await code(login(racing, { tenant_key: "acme", username: "an", password: PW }, WEB));
    expect(r).toBe("TEMP_LOCKED");
    const [t] = await owner`select count(*)::int as n from admin.refresh_tokens`;
    expect(t?.n).toBe(0);
    const [u] = await owner`select last_login_at, locked_until from admin.users where id = ${AN}`;
    expect(u?.last_login_at).toBeNull();
    expect(u?.locked_until).not.toBeNull();
  });

  test("ADM-FR-06 · cùng race ở nhánh must_change_password → không phát change_token", async () => {
    const bad = { tenant_key: "acme", username: "dung", password: "Wrong-Passw0rd-1" };
    const racing: AuthCtx = {
      ...ctx,
      beforeVerify: async () => {
        for (let i = 0; i < 5; i++) await code(login(ctx, bad, WEB));
      },
    };
    const input = { tenant_key: "acme", username: "dung", password: PW };
    expect(await code(login(racing, input, WEB))).toBe("TEMP_LOCKED");
  });

  test("ADM-FR-06 · đổi mật khẩu bắt buộc ghi last_login_at (review vòng 1 #2)", async () => {
    const r = await login(ctx, { tenant_key: "acme", username: "dung", password: PW }, WEB);
    if (r.kind !== "change") throw new Error("expected change");
    await changePasswordForced(
      ctx,
      { change_token: r.body.change_token, new_password: "New-Passw0rd-9" },
      WEB,
    );
    const [u] = await owner`select last_login_at from admin.users where id = ${DUNG}`;
    expect(new Date(u?.last_login_at).toISOString()).toBe(clock.toISOString());
  });
});
