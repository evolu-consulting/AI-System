// ADM-FR-02, ADM-FR-03, ADM-FR-05 · POST /auth/refresh, /auth/logout (test-plan A2; AC-A02, M1-AC04; M1-R07/R08/R09).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { TokenGrantSchema } from "@ai/contracts";
import {
  clearsCookie,
  cookieOf,
  createEnv,
  decode,
  type Env,
  EXT,
  expectErr,
  PW,
  type Res,
  sha256,
  TEMP_PW,
  TENANT_ID,
  USER_ID,
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

const rotate = (cookie: string | undefined): Promise<Res> => env.post("/auth/refresh", { cookie });
const cookieValue = (cookie: string | undefined) => cookie?.replace("ai_rt=", "") ?? "";
const tokenRow = async (cookie: string | undefined) => {
  const [r] = await env.owner`select * from admin.refresh_tokens
    where token_hash = ${sha256(cookieValue(cookie))}`;
  return r;
};
/** Lùi revoked_at của token (đã xoay) để mô phỏng thời gian trôi, không dùng sleep. */
const ageRevocation = (cookie: string | undefined, seconds: number) =>
  env.owner`update admin.refresh_tokens set revoked_at = revoked_at - make_interval(secs => ${seconds})
    where token_hash = ${sha256(cookieValue(cookie))}`;

describe("ADM-FR-02 · xoay vòng refresh token", () => {
  it("ADM-FR-02 · M1-R07 · refresh → 200 TokenGrant mới dùng được, cookie mới khác; hàng cũ rotated/replaced_by/cùng family/expires_at kế thừa", async () => {
    const s = await env.session("acme", "an", PW);
    const res = await rotate(s.cookie);
    expect(res.status).toBe(200);
    TokenGrantSchema.parse(res.json);
    const next = cookieOf(res);
    expect(next).toBeDefined();
    expect(next).not.toBe(s.cookie);
    expect((await env.get("/auth/me", { token: res.json.access_token })).status).toBe(200);
    const oldRow = await tokenRow(s.cookie);
    const newRow = await tokenRow(next);
    expect(oldRow?.revoked_at).not.toBeNull();
    expect(oldRow?.revoked_reason).toBe("rotated");
    expect(oldRow?.replaced_by).toBe(newRow?.id);
    expect(newRow?.family_id).toBe(oldRow?.family_id);
    expect(new Date(newRow?.expires_at).getTime()).toBe(new Date(oldRow?.expires_at).getTime());
  });

  it("ADM-FR-02 · M1-R07 · hạn tuyệt đối 30 ngày: sau 2 lần xoay expires_at vẫn bằng lần đăng nhập đầu", async () => {
    const s = await env.session("acme", "an", PW);
    const first = (await tokenRow(s.cookie))?.expires_at;
    const c2 = cookieOf(await rotate(s.cookie));
    const c3 = cookieOf(await rotate(c2));
    expect(c3).toBeDefined();
    expect(new Date((await tokenRow(c3))?.expires_at).getTime()).toBe(new Date(first).getTime());
  });

  it("ADM-FR-02 · M1-R07 · extension: refresh bằng body + X-Client → 200, refresh_token mới trong body, không Set-Cookie", async () => {
    const s = await env.session("acme", "an", PW, { headers: EXT });
    const res = await env.post("/auth/refresh", {
      headers: EXT,
      body: { refresh_token: s.refresh },
    });
    expect(res.status).toBe(200);
    const g = TokenGrantSchema.parse(res.json);
    expect(g.refresh_token).toBeDefined();
    expect(g.refresh_token).not.toBe(s.refresh);
    expect(res.cookies).toEqual([]);
  });

  it("ADM-FR-02 · spec §3 · quy tắc theo X-Client: extension chỉ gửi cookie → 401; web chỉ gửi body → 401", async () => {
    const web = await env.session("acme", "an", PW);
    const asExt = await env.post("/auth/refresh", { headers: EXT, cookie: web.cookie });
    expectErr(asExt, "INVALID_REFRESH_TOKEN");
    const ext = await env.session("acme", "lan", PW, { headers: EXT });
    const asWeb = await env.post("/auth/refresh", { body: { refresh_token: ext.refresh } });
    expectErr(asWeb, "INVALID_REFRESH_TOKEN");
  });

  it("ADM-FR-02 · M1-R07 · thiếu cookie / token lạ / token rỗng → 401 INVALID_REFRESH_TOKEN; web xoá cookie", async () => {
    for (const cookie of [undefined, "ai_rt=khong-co-token-nay", "ai_rt="]) {
      const res = await rotate(cookie);
      expectErr(res, "INVALID_REFRESH_TOKEN");
      expect(clearsCookie(res)).toBe(true);
    }
  });
});

describe("ADM-FR-02 · ân hạn và reuse", () => {
  it("ADM-FR-02 · M1-R07 · dùng lại token vừa xoay (≤ 10 s) → 401 REFRESH_SUPERSEDED, không Set-Cookie, chuỗi không bị thu hồi", async () => {
    const s = await env.session("acme", "an", PW);
    const c2 = cookieOf(await rotate(s.cookie));
    await ageRevocation(s.cookie, 9);
    const res = await rotate(s.cookie);
    expectErr(res, "REFRESH_SUPERSEDED");
    expect(res.cookies).toEqual([]);
    expect((await rotate(c2)).status).toBe(200);
    const [reused] = await env.owner`select count(*)::int as n from admin.refresh_tokens
      where revoked_reason = 'reuse'`;
    expect(reused?.n).toBe(0);
  });

  it("ADM-FR-02 · M1-AC04 · reuse (> 10 s) → 401 INVALID_REFRESH_TOKEN, thu hồi cả chuỗi, token mới cũng chết, cookie bị xoá", async () => {
    const s = await env.session("acme", "an", PW);
    const c2 = cookieOf(await rotate(s.cookie));
    await ageRevocation(s.cookie, 11);
    const res = await rotate(s.cookie);
    expectErr(res, "INVALID_REFRESH_TOKEN");
    expect(clearsCookie(res)).toBe(true);
    const oldRow = await tokenRow(s.cookie);
    const rows = await env.owner`select revoked_at, revoked_reason, id from admin.refresh_tokens
      where family_id = ${oldRow?.family_id}`;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.revoked_at).not.toBeNull();
    expect((await tokenRow(c2))?.revoked_reason).toBe("reuse");
    expectErr(await rotate(c2), "INVALID_REFRESH_TOKEN");
  });

  it("ADM-FR-02 · M1-AC04 · reuse chỉ thu hồi đúng chuỗi: phiên thứ hai của cùng user và phiên của user khác vẫn refresh được", async () => {
    const a1 = await env.session("acme", "an", PW);
    const a2 = await env.session("acme", "an", PW);
    const other = await env.session("acme", "lan", PW);
    await rotate(a1.cookie);
    await ageRevocation(a1.cookie, 11);
    expectErr(await rotate(a1.cookie), "INVALID_REFRESH_TOKEN");
    expect((await rotate(a2.cookie)).status).toBe(200);
    expect((await rotate(other.cookie)).status).toBe(200);
  });

  it("ADM-FR-02 · M1-R07 · 5 refresh song song cùng cookie → đúng 1×200 và 4×401 REFRESH_SUPERSEDED (không Set-Cookie); chuỗi có đúng 2 hàng", async () => {
    const s = await env.session("acme", "an", PW);
    const results = await Promise.all(Array.from({ length: 5 }, () => rotate(s.cookie)));
    const winners = results.filter((r) => r.status === 200);
    const losers = results.filter((r) => r.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    for (const l of losers) {
      expectErr(l, "REFRESH_SUPERSEDED");
      expect(l.cookies).toEqual([]);
    }
    const family = (await tokenRow(s.cookie))?.family_id;
    const rows = await env.owner`select revoked_reason from admin.refresh_tokens
      where family_id = ${family} order by created_at`;
    expect(rows.map((r) => r.revoked_reason)).toEqual(["rotated", null]);
    const [winner] = winners;
    expect((await rotate(cookieOf(winner as Res))).status).toBe(200);
  });

  it("ADM-FR-02 · M1-R07 · token hết hạn → 401 INVALID_REFRESH_TOKEN (không phải REFRESH_SUPERSEDED)", async () => {
    const s = await env.session("acme", "an", PW);
    await env.owner`update admin.refresh_tokens set expires_at = now() - interval '1 minute'
      where user_id = ${USER_ID.an}`;
    expectErr(await rotate(s.cookie), "INVALID_REFRESH_TOKEN");
  });

  it("ADM-FR-02 · M1-R07 · user/tenant không còn đăng nhập được (không thu hồi token) → refresh 401: active=false, locked_by_tenant, tenant khoá", async () => {
    const cases = [
      () => env.owner`update admin.users set active = false where id = ${USER_ID.an}`,
      () => env.owner`update admin.users set locked_by_tenant = true where id = ${USER_ID.an}`,
      () => env.owner`update admin.tenants set active = false where id = ${TENANT_ID.acme}`,
    ];
    for (const mutate of cases) {
      await env.reset();
      const s = await env.session("acme", "an", PW);
      await mutate();
      expectErr(await rotate(s.cookie), "INVALID_REFRESH_TOKEN");
    }
  });
});

describe("ADM-FR-05 · AC-A02 · khoá user thu hồi phiên", () => {
  it("ADM-FR-05 · AC-A02 · binh khoá an (extension) → refresh 401; token an user_locked; access token cũ bị chặn ngay; exp ≤ iat+900; user khác không bị đụng", async () => {
    const an = await env.session("acme", "an", PW, { headers: EXT });
    const lan = await env.session("acme", "lan", PW, { headers: EXT });
    const binh = await env.token("acme", "binh");
    const lock = await env.post(`/admin/users/${USER_ID.an}/lock`, { token: binh });
    expect(lock.status).toBe(200);
    const res = await env.post("/auth/refresh", {
      headers: EXT,
      body: { refresh_token: an.refresh },
    });
    expectErr(res, "INVALID_REFRESH_TOKEN");
    const rows = await env.owner`select revoked_reason from admin.refresh_tokens
      where user_id = ${USER_ID.an}`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.revoked_reason).toBe("user_locked");
    expectErr(await env.get("/auth/me", { token: an.token }), "UNAUTHORIZED");
    const { claims } = decode(an.token);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBeLessThanOrEqual(900);
    const ok = await env.post("/auth/refresh", {
      headers: EXT,
      body: { refresh_token: lan.refresh },
    });
    expect(ok.status).toBe(200);
  });
});

describe("ADM-FR-03 · đăng xuất", () => {
  it("ADM-FR-03 · M1-R08 · logout bằng cookie → 204 + xoá cookie; hàng logout; refresh sau đó → 401", async () => {
    const s = await env.session("acme", "an", PW);
    const res = await env.post("/auth/logout", { cookie: s.cookie });
    expect(res.status).toBe(204);
    expect(clearsCookie(res)).toBe(true);
    expect((await tokenRow(s.cookie))?.revoked_reason).toBe("logout");
    expectErr(await rotate(s.cookie), "INVALID_REFRESH_TOKEN");
  });

  it("ADM-FR-03 · M1-R08 · idempotent: logout lần 2, token lạ, không token, body extension → 204", async () => {
    const s = await env.session("acme", "an", PW);
    await env.post("/auth/logout", { cookie: s.cookie });
    expect((await env.post("/auth/logout", { cookie: s.cookie })).status).toBe(204);
    expect((await env.post("/auth/logout", { cookie: "ai_rt=khong-co-token-nay" })).status).toBe(
      204,
    );
    expect((await env.post("/auth/logout")).status).toBe(204);
    const ext = await env.session("acme", "lan", PW, { headers: EXT });
    const res = await env.post("/auth/logout", {
      headers: EXT,
      body: { refresh_token: ext.refresh },
    });
    expect(res.status).toBe(204);
    expect(res.cookies).toEqual([]);
    const again = await env.post("/auth/logout", {
      headers: EXT,
      body: { refresh_token: ext.refresh },
    });
    expect(again.status).toBe(204);
  });

  it("ADM-FR-03 · M1-R08 · logout không đụng phiên khác", async () => {
    const a = await env.session("acme", "an", PW);
    const b = await env.session("acme", "lan", PW);
    const a2 = await env.session("acme", "an", PW);
    await env.post("/auth/logout", { cookie: a.cookie });
    expect((await rotate(b.cookie)).status).toBe(200);
    expect((await rotate(a2.cookie)).status).toBe(200);
  });
});

describe("ADM-NFR-01 · không rò refresh token", () => {
  it("ADM-NFR-01 · M1-R07 · web không bao giờ có refresh_token trong body (login, refresh, đổi mật khẩu bắt buộc)", async () => {
    const login = await env.login("acme", "an", PW);
    expect(login.json.refresh_token).toBeUndefined();
    const refreshed = await rotate(cookieOf(login));
    expect(refreshed.status).toBe(200);
    expect(refreshed.json.refresh_token).toBeUndefined();
    const need = await env.login("acme", "dung", TEMP_PW);
    const changed = await env.post("/auth/change-password", {
      body: { change_token: need.json.change_token, new_password: "New-Passw0rd-9" },
    });
    expect(changed.status).toBe(200);
    expect(changed.json.refresh_token).toBeUndefined();
    expect(cookieOf(changed)).toBeDefined();
  });

  it("ADM-NFR-01 · M1-R07 · extension không bao giờ có Set-Cookie (login, refresh, đổi mật khẩu bắt buộc)", async () => {
    const login = await env.login("acme", "an", PW, { headers: EXT });
    expect(login.cookies).toEqual([]);
    const refreshed = await env.post("/auth/refresh", {
      headers: EXT,
      body: { refresh_token: login.json.refresh_token },
    });
    expect(refreshed.cookies).toEqual([]);
    const need = await env.login("acme", "dung", TEMP_PW, { headers: EXT });
    const changed = await env.post("/auth/change-password", {
      headers: EXT,
      body: { change_token: need.json.change_token, new_password: "New-Passw0rd-9" },
    });
    expect(changed.status).toBe(200);
    expect(changed.cookies).toEqual([]);
    expect(changed.json.refresh_token).toBeDefined();
  });
});
