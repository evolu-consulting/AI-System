// ADM-FR-06, ADM-FR-07, ADM-NFR-01 · đổi mật khẩu + /auth/me (test-plan A3; M1-AC06; M1-R05/R06).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { MeSchema, TokenGrantSchema } from "@ai/contracts";
import {
  cookieOf,
  createEnv,
  type Env,
  expectErr,
  insertRefresh,
  makeKeys,
  PW,
  sha256,
  signJwt,
  TEMP_PW,
  TENANT_ID,
  USER_ID,
  wrongLogins,
} from "./_fixtures";

const NEW_PW = "New-Passw0rd-9";
let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset();
});

const dungToken = async (): Promise<string> => {
  const res = await env.login("acme", "dung", TEMP_PW);
  return res.json.change_token;
};
const forced = (change_token: string, new_password: string, headers?: Record<string, string>) =>
  env.post("/auth/change-password", { headers, body: { change_token, new_password } });
const userRow = async (id: string) => {
  const [r] = await env.owner`select * from admin.users where id = ${id}`;
  return r;
};

describe("ADM-FR-06 · M1-AC06 · đổi mật khẩu bắt buộc", () => {
  it("ADM-FR-06 · M1-AC06 · mật khẩu mới < 10, > 128 → 400 VALIDATION_ERROR; = mật khẩu tạm → 400 PASSWORD_UNCHANGED", async () => {
    const token = await dungToken();
    expectErr(await forced(token, "a".repeat(9)), "VALIDATION_ERROR");
    expectErr(await forced(token, "a".repeat(129)), "VALIDATION_ERROR");
    expectErr(await forced(token, TEMP_PW), "PASSWORD_UNCHANGED");
  });

  it("ADM-FR-06 · M1-AC06 · hợp lệ → 200 TokenGrant (+cookie); DB must_change_password=false, password_changed_at mới, version+1; đăng nhập lại bình thường", async () => {
    const before = await userRow(USER_ID.dung);
    const token = await dungToken();
    const res = await forced(token, NEW_PW);
    expect(res.status).toBe(200);
    TokenGrantSchema.parse(res.json);
    expect(cookieOf(res)).toBeDefined();
    const after = await userRow(USER_ID.dung);
    expect(after?.must_change_password).toBe(false);
    expect(new Date(after?.password_changed_at).getTime()).toBeGreaterThan(
      new Date(before?.password_changed_at).getTime(),
    );
    expect(after?.version).toBe(before?.version + 1);
    expectErr(await env.login("acme", "dung", TEMP_PW), "INVALID_CREDENTIALS");
    const again = await env.login("acme", "dung", NEW_PW);
    expect(again.json.status).toBe("authenticated");
  });

  it("ADM-FR-06 · M1-R05 · change_token chỉ dùng một lần: lần 2 → 401 INVALID_CHANGE_TOKEN", async () => {
    const token = await dungToken();
    expect((await forced(token, NEW_PW)).status).toBe(200);
    expectErr(await forced(token, "Another-Passw0rd-1"), "INVALID_CHANGE_TOKEN");
  });

  it("ADM-FR-06 · M1-R05 · change_token hết hạn / sai khoá / sai chữ ký / access token (aud khác) → 401 INVALID_CHANGE_TOKEN", async () => {
    const real = await dungToken();
    const [r] =
      await env.owner`select password_changed_at from admin.users where id = ${USER_ID.dung}`;
    const claims = { tid: TENANT_ID.acme, pwc: new Date(r?.password_changed_at).getTime() };
    const base = { sub: USER_ID.dung, aud: "admin:password-change", claims };
    const expired = await signJwt({
      ...base,
      expOffsetS: -60,
      iatOffsetS: -400,
      privatePem: env.keys.privatePem,
    });
    const foreign = await signJwt({ ...base, expOffsetS: 300, privatePem: makeKeys().privatePem });
    const tampered = `${real.slice(0, -4)}${real.endsWith("AAAA") ? "BBBB" : "AAAA"}`;
    const access = (await env.session("acme", "an", PW)).token;
    for (const t of [expired, foreign, tampered, access]) {
      expectErr(await forced(t, NEW_PW), "INVALID_CHANGE_TOKEN");
    }
  });

  it("ADM-FR-06 · M1-R04 · user bị khoá sau khi nhận change_token → 403 ACCOUNT_LOCKED", async () => {
    const token = await dungToken();
    await env.owner`update admin.users set active = false where id = ${USER_ID.dung}`;
    expectErr(await forced(token, NEW_PW), "ACCOUNT_LOCKED");
  });

  it("ADM-FR-06 · M1-R06 · đổi xong thu hồi mọi refresh token cũ của user (password_changed)", async () => {
    const old = await insertRefresh(env.owner, { userId: USER_ID.dung, tenantId: TENANT_ID.acme });
    const token = await dungToken();
    expect((await forced(token, NEW_PW)).status).toBe(200);
    const [row] =
      await env.owner`select revoked_reason from admin.refresh_tokens where id = ${old.id}`;
    expect(row?.revoked_reason).toBe("password_changed");
  });
});

describe("ADM-FR-06 · tự đổi mật khẩu", () => {
  const selfChange = (token: string, body: unknown) =>
    env.post("/auth/change-password", { token, body });

  it("ADM-FR-06 · M1-R06 · an (member) tự đổi → 204; mật khẩu cũ 401, mới 200; phiên hiện tại sống, phiên khác bị thu hồi password_changed", async () => {
    const other = await env.session("acme", "an", PW);
    const current = await env.session("acme", "an", PW);
    const res = await selfChange(current.token, { current_password: PW, new_password: NEW_PW });
    expect(res.status).toBe(204);
    const rows = await env.owner`select family_id, id, revoked_reason from admin.refresh_tokens
      where user_id = ${USER_ID.an}`;
    const byCookie = async (cookie: string | undefined) => {
      const hash = sha256((cookie ?? "").replace("ai_rt=", ""));
      const [t] = await env.owner`select revoked_reason from admin.refresh_tokens
        where token_hash = ${hash}`;
      return t?.revoked_reason;
    };
    expect(rows).toHaveLength(2);
    expect(await byCookie(current.cookie)).toBeNull();
    expect(await byCookie(other.cookie)).toBe("password_changed");
    expectErr(await env.login("acme", "an", PW), "INVALID_CREDENTIALS");
    expect((await env.login("acme", "an", NEW_PW)).status).toBe(200);
  });

  it("ADM-FR-06 · M1-R06 · current_password sai → 400 INVALID_CURRENT_PASSWORD (không phải 401)", async () => {
    const t = await env.token("acme", "an");
    const res = await selfChange(t, { current_password: "Sai-Passw0rd-1", new_password: NEW_PW });
    expectErr(res, "INVALID_CURRENT_PASSWORD");
    expect(res.status).toBe(400);
  });

  it("ADM-FR-07 · M1-R03 · 5 lần current_password sai tính vào bộ đếm → lần 6 (cả khi đúng) → 423 TEMP_LOCKED {until}", async () => {
    const t = await env.token("acme", "an");
    for (let i = 0; i < 5; i++) {
      const res = await selfChange(t, { current_password: "Sai-Passw0rd-1", new_password: NEW_PW });
      expectErr(res, "INVALID_CURRENT_PASSWORD");
    }
    const res = await selfChange(t, { current_password: PW, new_password: NEW_PW });
    expectErr(res, "TEMP_LOCKED");
    expect(res.json.error.details.until).toBe("2026-10-01T09:15:00.000Z");
  });

  it("ADM-FR-06 · M1-R06 · new_password = current → 400 PASSWORD_UNCHANGED; new < 10 → 400 VALIDATION_ERROR", async () => {
    const t = await env.token("acme", "an");
    expectErr(
      await selfChange(t, { current_password: PW, new_password: PW }),
      "PASSWORD_UNCHANGED",
    );
    expectErr(
      await selfChange(t, { current_password: PW, new_password: "short-1" }),
      "VALIDATION_ERROR",
    );
  });

  it("ADM-FR-06 · spec §3 · dạng body sai (cả hai trường / không có / trường lạ) → 400; tự đổi không Bearer → 401", async () => {
    const t = await env.token("acme", "an");
    const bad = [
      { current_password: PW, change_token: "x", new_password: NEW_PW },
      { new_password: NEW_PW },
      { current_password: PW, new_password: NEW_PW, extra: 1 },
    ];
    for (const body of bad) expectErr(await selfChange(t, body), "VALIDATION_ERROR");
    const anon = await env.post("/auth/change-password", {
      body: { current_password: PW, new_password: NEW_PW },
    });
    expectErr(anon, "UNAUTHORIZED");
  });
});

describe("ADM-FR-06 · GET/PATCH /auth/me", () => {
  it("ADM-FR-06 · spec §3 · GET /auth/me → 200 đúng MeSchema (must_change_password=false, tenant {id,key,name}); không Bearer → 401", async () => {
    const t = await env.token("acme", "an");
    const res = await env.get("/auth/me", { token: t });
    expect(res.status).toBe(200);
    const me = MeSchema.parse(res.json);
    expect(me.tenant).toEqual({ id: TENANT_ID.acme, key: "acme", name: "Acme Corp" });
    expect(me.id).toBe(USER_ID.an);
    expectErr(await env.get("/auth/me"), "UNAUTHORIZED");
  });

  it("ADM-FR-06 · M1-R22 · PATCH /auth/me {locale:'en'} → 200 locale en; DB users.locale và version+1", async () => {
    const t = await env.token("acme", "an");
    const before = await userRow(USER_ID.an);
    const res = await env.patch("/auth/me", { token: t, body: { locale: "en" } });
    expect(res.status).toBe(200);
    expect(MeSchema.parse(res.json).locale).toBe("en");
    const after = await userRow(USER_ID.an);
    expect(after?.locale).toBe("en");
    expect(after?.version).toBe(before?.version + 1);
  });

  it("ADM-FR-06 · M1-R22 · PATCH /auth/me: locale 'fr', thiếu locale, trường lạ (role) → 400; không đổi được role", async () => {
    const t = await env.token("acme", "an");
    for (const body of [{ locale: "fr" }, {}, { locale: "vi", role: "tenant_admin" }]) {
      expectErr(await env.patch("/auth/me", { token: t, body }), "VALIDATION_ERROR");
    }
    expect((await userRow(USER_ID.an))?.role).toBe("member");
  });

  it("ADM-FR-07 · M1-R03 · đăng nhập sai không làm đổi version (dùng chung bộ đếm với đổi mật khẩu)", async () => {
    const before = await userRow(USER_ID.an);
    await wrongLogins(env, "acme", "an", 2);
    expect((await userRow(USER_ID.an))?.version).toBe(before?.version);
  });
});

describe("ADM-FR-06 · review vòng 1 #2 · đổi mật khẩu bắt buộc ghi last_login_at", () => {
  it("ADM-FR-06 · M1-R05 · đổi mật khẩu bắt buộc xong → last_login_at khác null, user không còn trong bộ lọc login=never", async () => {
    const binh = await env.token("acme", "binh");
    const never = async () =>
      (await env.get("/admin/users?login=never", { token: binh })).json.items.map(
        (u: { username: string }) => u.username,
      );
    expect(await never()).toContain("dung");
    expect((await userRow(USER_ID.dung))?.last_login_at).toBeNull();
    expect((await forced(await dungToken(), NEW_PW)).status).toBe(200);
    expect((await userRow(USER_ID.dung))?.last_login_at).not.toBeNull();
    expect(await never()).not.toContain("dung");
  });
});
