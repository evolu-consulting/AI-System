// ADM-FR-08 · M4-R16 · M4-AC11 · đăng nhập 2 bước (test-plan-cd §2.2, T9c). Xanh ở T9c.
// Clock giả: mỗi mã mới = `nextCode` (+30 s) để chống dùng lại không chặn nhầm. `enable2fa` gọi trong thân `it`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { cookieOf, decode, makeKeys, signJwt } from "../M1/_fixtures";
import {
  auditMark,
  auditSince,
  backupRows,
  createM3Env,
  type Enabled,
  EXT,
  enable2fa,
  expectErr,
  login,
  type M3Env,
  nextCode,
  nowS,
  PW,
  TEMP_PW,
  TENANT_ID,
  totpRow,
  totpToken,
  USER_ID,
  userRow,
  verify,
} from "./_cd";
import { stepOf, totpAt, wrongCodeAt } from "./_totp";

let env: M3Env;
beforeAll(async () => {
  env = await createM3Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset3();
});

const WRONG_PW = "Wrong-Passw0rd-9";
const on = (): Promise<Enabled> => enable2fa(env, "acme", "binh", PW);
const tokenBinh = () => totpToken(env, "acme", "binh", PW);
const wrong = (e: Enabled) => wrongCodeAt(e.secret, nowS(env));
const failed = async () => (await userRow(env, USER_ID.binh)).failed_logins;

describe("ADM-FR-08 · login → totp_required → verify", () => {
  it("ADM-FR-08 · D-L01 · M4-AC11 · login đúng khi đã bật → 200 totp_required (không access_token, không cookie); JWT aud admin:totp, TTL 300", async () => {
    await on();
    const res = await login(env, "acme", "binh", PW);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "totp_required", expires_in: 300 });
    expect(res.json.access_token).toBeUndefined();
    expect(res.cookies).toHaveLength(0);
    const { claims } = decode(res.json.totp_token);
    expect(claims.aud).toBe("admin:totp");
    expect(Number(claims.exp) - Number(claims.iat)).toBe(300);
    expect(claims.sub).toBe(USER_ID.binh);
    expect(claims.tid).toBe(TENANT_ID.acme);
    expect(claims.pwc).toBeDefined();
    expect(claims.tte).toBeDefined();
  });

  it("ADM-FR-08 · D-L02 · verify mã bước mới → TokenGrant + cookie (web), refresh_token trong body (extension); DB cập nhật", async () => {
    const e = await on();
    const web = await verify(env, { totp_token: await tokenBinh(), code: nextCode(env, e.secret) });
    expect(web.status).toBe(200);
    expect(web.json.status).toBe("authenticated");
    expect(cookieOf(web)).toBeDefined();
    const tok = await tokenBinh();
    const code = nextCode(env, e.secret);
    const ext = await verify(env, { totp_token: tok, code }, EXT);
    expect(ext.status).toBe(200);
    expect(typeof ext.json.refresh_token).toBe("string");
    const u = await userRow(env, USER_ID.binh);
    expect(new Date(u.last_login_at as Date).getTime()).toBe(env.clock.now().getTime());
    expect(u.failed_logins).toBe(0);
    expect(Number((await totpRow(env, USER_ID.binh)).last_used_step)).toBe(stepOf(nowS(env)));
  });

  it("ADM-FR-08 · D-L03 · R16 chống dùng lại · cùng mã vừa dùng → 401 INVALID_OTP; mã bước cũ hơn → 401; bộ đếm +1 mỗi lần", async () => {
    const e = await on();
    const code = nextCode(env, e.secret);
    expect((await verify(env, { totp_token: await tokenBinh(), code })).status).toBe(200);
    expectErr(await verify(env, { totp_token: await tokenBinh(), code }), "INVALID_OTP");
    expect(await failed()).toBe(1);
    const older = totpAt(e.secret, nowS(env) - 30);
    expectErr(await verify(env, { totp_token: await tokenBinh(), code: older }), "INVALID_OTP");
    expect(await failed()).toBe(2);
  });

  it("ADM-FR-08 · D-L04 · plan D4 · mật khẩu đúng không reset bộ đếm; mã sai thứ 5 khoá; mã đúng sau đó → 423; login lại → 423", async () => {
    const e = await on();
    for (let i = 1; i <= 4; i++) {
      expect((await login(env, "acme", "binh", WRONG_PW)).status).toBe(401);
      expect(await failed()).toBe(i);
    }
    const tok = await tokenBinh();
    expect(await failed()).toBe(4);
    expectErr(await verify(env, { totp_token: tok, code: wrong(e) }), "INVALID_OTP");
    // AC-A01 (M1 afterFailedLogin): lần sai thứ 5 → {failed_logins: 0, locked_until: +15'}
    const u = await userRow(env, USER_ID.binh);
    expect(u.failed_logins).toBe(0);
    expect(new Date(u.locked_until as Date).getTime()).toBe(
      env.clock.now().getTime() + 15 * 60_000,
    );
    expectErr(await verify(env, { totp_token: tok, code: nextCode(env, e.secret) }), "TEMP_LOCKED");
    expectErr(await login(env, "acme", "binh", PW), "TEMP_LOCKED");
  });

  it("ADM-FR-08 · D-L05 · M4-AC11 · 5 mã sai → 401 ×5; mã đúng → 423 {until}; tới until → đăng nhập lại được, bộ đếm về 0", async () => {
    const e = await on();
    const tok = await tokenBinh();
    for (let i = 0; i < 5; i++)
      expectErr(await verify(env, { totp_token: tok, code: wrong(e) }), "INVALID_OTP");
    const locked = await verify(env, { totp_token: tok, code: nextCode(env, e.secret) });
    expectErr(locked, "TEMP_LOCKED");
    const until = locked.json.error.details.until as string;
    env.clock.set(new Date(until));
    const ok = await verify(env, { totp_token: await tokenBinh(), code: nextCode(env, e.secret) });
    expect(ok.status).toBe(200);
    const u = await userRow(env, USER_ID.binh);
    expect(u.failed_logins).toBe(0);
    expect(u.locked_until).toBeNull();
  });

  it("ADM-FR-08 · D-L06 · M4-AC11 · mã dự phòng dùng một lần; viết HOA không gạch vẫn nhận; DB 2 hàng used_at", async () => {
    const e = await on();
    const [c0, c1] = e.backupCodes as [string, string];
    expect((await verify(env, { totp_token: await tokenBinh(), backup_code: c0 })).status).toBe(
      200,
    );
    expectErr(await verify(env, { totp_token: await tokenBinh(), backup_code: c0 }), "INVALID_OTP");
    const upper = c1.toUpperCase().replace("-", "");
    expect((await verify(env, { totp_token: await tokenBinh(), backup_code: upper })).status).toBe(
      200,
    );
    const used = (await backupRows(env, USER_ID.binh)).filter((r) => r.used_at !== null);
    expect(used).toHaveLength(2);
  });
});

describe("ADM-FR-08 · totp_token hỏng / mất hiệu lực", () => {
  it("ADM-FR-08 · D-L07 · token rác / access token / change_token / khoá khác / hết hạn → 401 INVALID_TOTP_TOKEN ×5, bộ đếm không đổi", async () => {
    const e = await on();
    const change = await login(env, "acme", "dung", TEMP_PW);
    expect(change.json.status).toBe("password_change_required");
    const forged = await signJwt({
      sub: USER_ID.binh,
      aud: "admin:totp",
      claims: { tid: TENANT_ID.acme, pwc: 0, tte: 0 },
      expOffsetS: 300,
      privatePem: makeKeys().privatePem,
    });
    const bad = ["rac.rac.rac", e.token, change.json.change_token as string, forged];
    for (const t of bad) {
      expectErr(
        await verify(env, { totp_token: t, code: nextCode(env, e.secret) }),
        "INVALID_TOTP_TOKEN",
      );
    }
    const tok = await tokenBinh();
    env.clock.advance(301_000);
    expectErr(
      await verify(env, { totp_token: tok, code: totpAt(e.secret, nowS(env)) }),
      "INVALID_TOTP_TOKEN",
    );
    expect(await failed()).toBe(0);
  });

  it("ADM-FR-08 · D-L08a · admin reset mật khẩu binh sau khi lấy token → 401 INVALID_TOTP_TOKEN", async () => {
    const e = await on();
    const tok = await tokenBinh();
    const r = await env.post(`/admin/users/${USER_ID.binh}/reset-password`, {
      token: await env.admin(),
    });
    expect(r.status).toBe(200);
    expectErr(
      await verify(env, { totp_token: tok, code: nextCode(env, e.secret) }),
      "INVALID_TOTP_TOKEN",
    );
  });

  it("ADM-FR-08 · D-L08b · binh tự tắt 2FA (phiên khác) sau khi lấy token → 401 INVALID_TOTP_TOKEN", async () => {
    const e = await on();
    const tok = await tokenBinh();
    const off = await env.post("/auth/totp/disable", {
      token: e.token,
      body: { current_password: PW, backup_code: e.backupCodes[0] },
    });
    expect(off.status).toBe(204);
    expectErr(
      await verify(env, { totp_token: tok, code: nextCode(env, e.secret) }),
      "INVALID_TOTP_TOKEN",
    );
  });

  it("ADM-FR-08 · D-L08c · tắt rồi bật lại (tte đổi) → token cũ 401 INVALID_TOTP_TOKEN", async () => {
    const e = await on();
    const tok = await tokenBinh();
    const off = await env.post("/auth/totp/disable", {
      token: e.token,
      body: { current_password: PW, backup_code: e.backupCodes[0] },
    });
    expect(off.status).toBe(204);
    env.clock.advance(30_000);
    const e2 = await on();
    expectErr(
      await verify(env, { totp_token: tok, code: nextCode(env, e2.secret) }),
      "INVALID_TOTP_TOKEN",
    );
  });

  it("ADM-FR-08 · D-L09 · Q10 · chi bật 2FA + must_change_password → totp_required rồi password_change_required", async () => {
    const e = await enable2fa(env, "acme", "chi", PW);
    await env.owner`update admin.users set must_change_password = true where id = ${USER_ID.chi}`;
    const tok = await totpToken(env, "acme", "chi", PW);
    const res = await verify(env, { totp_token: tok, code: nextCode(env, e.secret) });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("password_change_required");
    expect(typeof res.json.change_token).toBe("string");
  });

  it("ADM-FR-08 · D-L10 · M1-R04 · user bị khoá: login → 403 ACCOUNT_LOCKED (không totp_token); khoá sau khi lấy token → verify 403", async () => {
    const e = await on();
    await env.owner`update admin.users set active = false where id = ${USER_ID.binh}`;
    const res = await login(env, "acme", "binh", PW);
    expectErr(res, "ACCOUNT_LOCKED");
    expect(res.json.totp_token).toBeUndefined();
    await env.owner`update admin.users set active = true where id = ${USER_ID.binh}`;
    const tok = await tokenBinh();
    await env.owner`update admin.users set active = false where id = ${USER_ID.binh}`;
    expectErr(
      await verify(env, { totp_token: tok, code: nextCode(env, e.secret) }),
      "ACCOUNT_LOCKED",
    );
  });

  it("ADM-FR-08 · D-L11 · user không bật 2FA (an) đăng nhập như M1 → TokenGrant", async () => {
    const res = await login(env, "acme", "an", PW);
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("authenticated");
    expect(typeof res.json.access_token).toBe("string");
  });

  it("ADM-FR-08 · D-L12 · verify code '12a456' / cả 2 trường / không trường nào → 400 VALIDATION_ERROR", async () => {
    const e = await on();
    const tok = await tokenBinh();
    expectErr(await verify(env, { totp_token: tok, code: "12a456" }), "VALIDATION_ERROR");
    expectErr(
      await verify(env, { totp_token: tok, code: "123456", backup_code: e.backupCodes[0] }),
      "VALIDATION_ERROR",
    );
    expectErr(await verify(env, { totp_token: tok }), "VALIDATION_ERROR");
  });

  it("ADM-FR-08 · D-L13 · Q6 · login/verify (đúng, sai, mã dự phòng) không ghi audit_log", async () => {
    const e = await on();
    const mark = await auditMark(env);
    expect(
      (await verify(env, { totp_token: await tokenBinh(), code: nextCode(env, e.secret) })).status,
    ).toBe(200);
    expectErr(await verify(env, { totp_token: await tokenBinh(), code: wrong(e) }), "INVALID_OTP");
    const b = await verify(env, { totp_token: await tokenBinh(), backup_code: e.backupCodes[3] });
    expect(b.status).toBe(200);
    expect(await auditSince(env, mark)).toHaveLength(0);
  });
});

describe("ADM-FR-08 · song song", () => {
  it("ADM-FR-08 · D-L14 · R16 · 2 verify song song cùng mã đúng (2 token) → đúng 1 × 200, 1 × 401 INVALID_OTP", async () => {
    const e = await on();
    const [t1, t2] = [await tokenBinh(), await tokenBinh()];
    const code = nextCode(env, e.secret);
    const res = await Promise.all([t1, t2].map((t) => verify(env, { totp_token: t, code })));
    expect(res.map((r) => r.status).sort()).toEqual([200, 401]);
    const bad = res.find((r) => r.status === 401);
    expect(bad?.json.error.code).toBe("INVALID_OTP");
  });

  it("ADM-FR-08 · D-L15 · ADM-FR-07 · 10 verify sai song song → bị khoá; lần đúng kế → 423", async () => {
    const e = await on();
    const tok = await tokenBinh();
    const res = await Promise.all(
      Array.from({ length: 10 }, () => verify(env, { totp_token: tok, code: wrong(e) })),
    );
    for (const r of res) expect([401, 423]).toContain(r.status);
    expect((await userRow(env, USER_ID.binh)).locked_until).not.toBeNull();
    expectErr(await verify(env, { totp_token: tok, code: nextCode(env, e.secret) }), "TEMP_LOCKED");
  });
});
