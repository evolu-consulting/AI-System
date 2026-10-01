// ADM-FR-01, ADM-FR-06, ADM-FR-07, ADM-NFR-01 · POST /auth/login (test-plan A1; AC-A01; M1-R01…R05).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  LoginResponseSchema,
  PasswordChangeRequiredSchema,
  TokenGrantSchema,
  ValidationErrorDetailsSchema,
} from "@ai/contracts";
import { importSPKI, jwtVerify } from "jose";
import {
  createEnv,
  decode,
  type Env,
  EXT,
  expectErr,
  PW,
  sha256,
  TEMP_PW,
  TENANT_ID,
  USER_ID,
  wrongLogins,
} from "./_fixtures";

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

const row = async (id: string) => {
  const [r] = await env.owner`select failed_logins, locked_until, last_login_at, version,
    password_hash, password_changed_at from admin.users where id = ${id}`;
  return r;
};

describe("ADM-FR-01 · AC-A01 · đăng nhập thành công", () => {
  it("ADM-FR-01 · AC-A01 · acme/an + mật khẩu đúng → 200 TokenGrant (Bearer, 900 s, user = Me)", async () => {
    const res = await env.login("acme", "an", PW);
    expect(res.status).toBe(200);
    const g = TokenGrantSchema.parse(res.json);
    expect(g.token_type).toBe("Bearer");
    expect(g.expires_in).toBe(900);
    expect(g.user.tenant.key).toBe("acme");
    expect(g.user.username).toBe("an");
    expect(g.user.must_change_password).toBe(false);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("ADM-FR-01 · AC-A01 · access token: EdDSA + kid, claim sub/tid/role/iss/aud, exp-iat=900, có sid, verify được bằng public key", async () => {
    const res = await env.login("acme", "an", PW);
    const { access_token } = TokenGrantSchema.parse(res.json);
    const { header, claims } = decode(access_token);
    expect(header.alg).toBe("EdDSA");
    expect(header.kid).toBe("test-kid");
    expect(claims.sub).toBe(USER_ID.an);
    expect(claims.tid).toBe(TENANT_ID.acme);
    expect(claims.role).toBe("member");
    expect(claims.iss).toBe("admin");
    expect(claims.aud).toBe("ai-system");
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(900);
    expect(typeof claims.sid).toBe("string");
    const pub = await importSPKI(env.keys.publicPem, "EdDSA");
    await jwtVerify(access_token, pub, { issuer: "admin", audience: "ai-system" });
  });

  it("ADM-FR-01 · AC-A01 · web: cookie ai_rt HttpOnly/SameSite=Strict/Path=/auth/Max-Age=2592000, không Secure, body không có refresh_token", async () => {
    const res = await env.login("acme", "an", PW);
    const cookie = res.cookies.find((c) => c.startsWith("ai_rt="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).not.toMatch(/Secure/i);
    expect(res.json.refresh_token).toBeUndefined();
  });

  it("ADM-FR-01 · M1-R07 · appEnv production → cookie có Secure", async () => {
    const res = await env.prod("POST", "/auth/login", {
      body: { tenant_key: "acme", username: "an", password: PW },
    });
    expect(res.status).toBe(200);
    expect(res.cookies.find((c) => c.startsWith("ai_rt="))).toMatch(/Secure/i);
  });

  it("ADM-FR-01 · AC-A01 · extension (X-Client: extension): refresh_token trong body (>= 43 ký tự), không Set-Cookie", async () => {
    const res = await env.login("acme", "an", PW, { headers: EXT });
    const g = TokenGrantSchema.parse(res.json);
    expect(g.refresh_token?.length ?? 0).toBeGreaterThanOrEqual(43);
    expect(g.refresh_token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(res.cookies).toEqual([]);
  });

  it("ADM-FR-01 · M1-R07 · X-Client khác đúng chuỗi 'extension' (Extension, web) → coi là web", async () => {
    for (const v of ["Extension", "web"]) {
      const res = await env.login("acme", "an", PW, { headers: { "X-Client": v } });
      expect(res.status).toBe(200);
      expect(res.json.refresh_token).toBeUndefined();
      expect(res.cookies.some((c) => c.startsWith("ai_rt="))).toBe(true);
    }
  });

  it("ADM-FR-63 · M1-R01 · chuẩn hoá ' ACME '/'AN' → 200; globex/an cùng username khác tenant → 200 với tid=globex", async () => {
    const a = await env.login(" ACME ", "AN", PW);
    expect(a.status).toBe(200);
    const g = await env.login("globex", "an", PW);
    expect(g.status).toBe(200);
    expect(decode(g.json.access_token).claims.tid).toBe(TENANT_ID.globex);
    expect(decode(g.json.access_token).claims.sub).toBe(USER_ID.globexAn);
  });

  it("ADM-FR-01 · M1-R02 · /auth/login không cần Authorization; luôn có X-Request-Id (cả khi lỗi)", async () => {
    const ok = await env.login("acme", "an", PW);
    expect(ok.headers.get("x-request-id")).toBeTruthy();
    const bad = await env.login("acme", "an", "sai-mat-khau-1");
    expect(bad.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("ADM-FR-01 · M1-R01 · lỗi đồng nhất", () => {
  it("ADM-FR-01 · M1-R01 · 5 kiểu thất bại → cùng 401 INVALID_CREDENTIALS, body giống từng byte, không Set-Cookie", async () => {
    const attempts: Array<[string, string, string]> = [
      ["khong-co", "an", PW],
      ["acme", "khong-co", PW],
      ["acme", "an", "sai-mat-khau-1"],
      ["acme", "em", "sai-mat-khau-1"],
      ["zeta", "zed", "sai-mat-khau-1"],
    ];
    const texts = new Set<string>();
    for (const [t, u, p] of attempts) {
      const res = await env.login(t, u, p);
      expectErr(res, "INVALID_CREDENTIALS");
      expect(res.cookies).toEqual([]);
      texts.add(res.text);
    }
    expect(texts.size).toBe(1);
  });

  it("ADM-FR-07 · M1-R03 · user không tồn tại không có bộ đếm: 6 lần thử vẫn 401 và bảng users không đổi", async () => {
    const snap = async () => JSON.stringify(await env.owner`select * from admin.users order by id`);
    const before = await snap();
    const statuses = await wrongLogins(env, "acme", "khong-co", 6);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401]);
    expect(await snap()).toBe(before);
  });
});

describe("ADM-FR-07 · AC-A01 · khoá tạm 5 lần / 15 phút", () => {
  it("ADM-FR-07 · AC-A01 · 5 lần sai → 401×5; lần 6 đúng mật khẩu → 423 TEMP_LOCKED until=+15'; DB failed_logins=0", async () => {
    expect(await wrongLogins(env, "acme", "an", 5)).toEqual([401, 401, 401, 401, 401]);
    const res = await env.login("acme", "an", PW);
    expectErr(res, "TEMP_LOCKED");
    expect(res.json.error.details.until).toBe("2026-10-01T09:15:00.000Z");
    const r = await row(USER_ID.an);
    expect(r?.failed_logins).toBe(0);
    expect(new Date(r?.locked_until).toISOString()).toBe("2026-10-01T09:15:00.000Z");
  });

  it("ADM-FR-07 · M1-R03 · trong lúc khoá, mật khẩu sai cũng 423 và không tăng bộ đếm", async () => {
    await wrongLogins(env, "acme", "an", 5);
    const res = await env.login("acme", "an", "sai-mat-khau-1");
    expectErr(res, "TEMP_LOCKED");
    expect((await row(USER_ID.an))?.failed_logins).toBe(0);
  });

  it("ADM-FR-07 · M1-R03 · biên hết khoá: until-1ms vẫn 423; đúng until → 200, failed_logins=0, locked_until=null", async () => {
    await wrongLogins(env, "acme", "an", 5);
    const until = new Date("2026-10-01T09:15:00.000Z").getTime();
    env.clock.set(until - 1);
    expectErr(await env.login("acme", "an", PW), "TEMP_LOCKED");
    env.clock.set(until);
    expect((await env.login("acme", "an", PW)).status).toBe(200);
    const r = await row(USER_ID.an);
    expect(r?.failed_logins).toBe(0);
    expect(r?.locked_until).toBeNull();
  });

  it("ADM-FR-07 · M1-R03 · đăng nhập đúng đặt bộ đếm về 0 (4 sai + 1 đúng + 4 sai → vẫn 401); hết khoá rồi sai 1 lần → đếm lại từ 1", async () => {
    expect(await wrongLogins(env, "acme", "an", 4)).toEqual([401, 401, 401, 401]);
    expect((await env.login("acme", "an", PW)).status).toBe(200);
    expect(await wrongLogins(env, "acme", "an", 4)).toEqual([401, 401, 401, 401]);
    expect((await row(USER_ID.an))?.failed_logins).toBe(4);
    await wrongLogins(env, "acme", "an", 1); // lần 5 → khoá
    env.clock.advance(900_000);
    expectErr(await env.login("acme", "an", "sai-mat-khau-1"), "INVALID_CREDENTIALS");
    expect((await row(USER_ID.an))?.failed_logins).toBe(1);
  });
});

describe("ADM-FR-01 · M1-R04 · tài khoản bị khoá", () => {
  it("ADM-FR-01 · M1-R04 · em (active=false) và zeta/zed (khoá theo tenant) + mật khẩu đúng → 403 ACCOUNT_LOCKED", async () => {
    expectErr(await env.login("acme", "em", PW), "ACCOUNT_LOCKED");
    expectErr(await env.login("zeta", "zed", PW), "ACCOUNT_LOCKED");
  });

  it("ADM-FR-01 · M1-R04 · mật khẩu sai của hai user này → 401 INVALID_CREDENTIALS; 403 cũng đặt failed_logins=0", async () => {
    expectErr(await env.login("acme", "em", "sai-mat-khau-1"), "INVALID_CREDENTIALS");
    expectErr(await env.login("zeta", "zed", "sai-mat-khau-1"), "INVALID_CREDENTIALS");
    expectErr(await env.login("acme", "em", PW), "ACCOUNT_LOCKED");
    expectErr(await env.login("zeta", "zed", PW), "ACCOUNT_LOCKED");
    expect((await row(USER_ID.em))?.failed_logins).toBe(0);
    expect((await row(USER_ID.zed))?.failed_logins).toBe(0);
  });
});

describe("ADM-FR-06 · M1-R05 · password_change_required", () => {
  it("ADM-FR-06 · M1-AC06 · dung + mật khẩu tạm → 200 {status, change_token, expires_in:300}; không access/refresh token, không Set-Cookie", async () => {
    const res = await env.login("acme", "dung", TEMP_PW);
    expect(res.status).toBe(200);
    const body = PasswordChangeRequiredSchema.parse(res.json);
    expect(body.expires_in).toBe(300);
    expect(res.json.access_token).toBeUndefined();
    expect(res.json.refresh_token).toBeUndefined();
    expect(res.cookies).toEqual([]);
    expect(LoginResponseSchema.parse(res.json).status).toBe("password_change_required");
  });

  it("ADM-FR-06 · M1-R05 · change_token: aud 'admin:password-change', exp-iat=300, pwc = password_changed_at (epoch ms)", async () => {
    const res = await env.login("acme", "dung", TEMP_PW);
    const { claims } = decode(res.json.change_token);
    expect(claims.aud).toBe("admin:password-change");
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(300);
    expect(claims.sub).toBe(USER_ID.dung);
    const r = await row(USER_ID.dung);
    expect(claims.pwc).toBe(new Date(r?.password_changed_at).getTime());
  });
});

describe("ADM-FR-01 · ghi nhận đăng nhập", () => {
  it("ADM-FR-01 · M1-R03 · last_login_at ghi khi thành công (≈ clock), không đổi khi thất bại/bị khoá; users.version không đổi", async () => {
    const v0 = (await row(USER_ID.an))?.version;
    await env.login("acme", "an", "sai-mat-khau-1");
    expect((await row(USER_ID.an))?.last_login_at).toBeNull();
    await wrongLogins(env, "acme", "an", 4);
    expectErr(await env.login("acme", "an", PW), "TEMP_LOCKED");
    expect((await row(USER_ID.an))?.last_login_at).toBeNull();
    env.clock.advance(900_000);
    expect((await env.login("acme", "an", PW)).status).toBe(200);
    const r = await row(USER_ID.an);
    expect(new Date(r?.last_login_at).toISOString()).toBe("2026-10-01T09:15:00.000Z");
    expect(r?.version).toBe(v0);
  });

  it("ADM-NFR-01 · M1-R02 · refresh token chỉ lưu hash: token_hash=sha256 (32 byte), client, family_id=id, hạn ≈ 30 ngày; token thô không có ở bảng nào", async () => {
    const web = await env.login("acme", "an", PW);
    const ext = await env.login("acme", "lan", PW, { headers: EXT });
    const raw = ext.json.refresh_token as string;
    const [e] =
      await env.owner`select * from admin.refresh_tokens where token_hash = ${sha256(raw)}`;
    expect(e?.client).toBe("extension");
    expect(e?.family_id).toBe(e?.id);
    expect(Buffer.from(e?.token_hash).length).toBe(32);
    const thirtyDays = 30 * 86_400_000;
    expect(Math.abs(new Date(e?.expires_at).getTime() - (Date.now() + thirtyDays))).toBeLessThan(
      120_000,
    );
    const [w] =
      await env.owner`select client from admin.refresh_tokens where user_id = ${USER_ID.an}`;
    expect(w?.client).toBe("web");
    const cookieValue = /^ai_rt=([^;]+)/.exec(web.cookies[0] ?? "")?.[1] ?? "";
    for (const table of ["users", "tenants", "refresh_tokens"]) {
      const dump = JSON.stringify(
        await env.owner.unsafe(`select row_to_json(t)::text as j from admin.${table} t`),
      );
      expect(dump).not.toContain(raw);
      expect(dump).not.toContain(cookieValue);
    }
  });

  it("ADM-NFR-01 · M1-R02 · mật khẩu lưu argon2id (m=19456, t=2, p=1)", async () => {
    await env.login("acme", "an", PW);
    const r = await row(USER_ID.an);
    expect(r?.password_hash).toStartWith("$argon2id$v=19$m=19456,t=2,p=1$");
    const [s] = await env.owner`select password_hash from admin.users where username = 'admin'`;
    expect(s?.password_hash).toStartWith("$argon2id$v=19$m=19456,t=2,p=1$");
  });
});

describe("ADM-FR-01 · validate body", () => {
  it("ADM-FR-01 · spec §3 · thiếu trường / password rỗng / 129 ký tự / trường lạ → 400 VALIDATION_ERROR có details.issues", async () => {
    const full = { tenant_key: "acme", username: "an", password: PW };
    const bodies: unknown[] = [
      { username: "an", password: PW },
      { tenant_key: "acme", password: PW },
      { tenant_key: "acme", username: "an" },
      { ...full, password: "" },
      { ...full, password: "p".repeat(129) },
      { ...full, extra: 1 },
    ];
    for (const body of bodies) {
      const res = await env.post("/auth/login", { body });
      expectErr(res, "VALIDATION_ERROR");
      expect(
        ValidationErrorDetailsSchema.parse(res.json.error.details).issues.length,
      ).toBeGreaterThan(0);
    }
  });

  it("ADM-FR-01 · spec §3 · JSON hỏng → 400 VALIDATION_ERROR, issues[0].code = invalid_json", async () => {
    const res = await env.post("/auth/login", { raw: "{khong-phai-json" });
    expectErr(res, "VALIDATION_ERROR");
    const d = ValidationErrorDetailsSchema.parse(res.json.error.details);
    expect(d.issues[0]?.code).toBe("invalid_json");
    expect(d.issues[0]?.path).toEqual([]);
  });
});

describe("ADM-FR-07 · review vòng 1 #3 · khoá tạm với request song song", () => {
  it("ADM-FR-07 · M1-R03 · 10 lần sai + 1 lần đúng song song → tài khoản bị khoá tạm (locked_until), lần đúng kế tiếp → 423", async () => {
    const attempts = [
      ...Array.from({ length: 10 }, () => env.login("acme", "an", "Sai-Passw0rd-1")),
      env.login("acme", "an", PW),
    ];
    const rs = await Promise.all(attempts);
    for (const r of rs) expect([200, 401, 423]).toContain(r.status);
    expect(rs.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    // xác định: đưa về trạng thái khoá bằng đúng 5 lần sai nối tiếp rồi mọi lần đúng đều 423
    await env.reset();
    await Promise.all(Array.from({ length: 8 }, () => env.login("acme", "an", "Sai-Passw0rd-1")));
    const locked = await row(USER_ID.an);
    expect(locked?.locked_until).not.toBeNull();
    // chỉ đúng 5 lần sai đầu được đếm; lần sai đến sau khi đã khoá không được cộng thêm vào bộ đếm
    expect(locked?.failed_logins).toBe(0);
    expectErr(await env.login("acme", "an", PW), "TEMP_LOCKED");
  });
});
