// ADM-FR-08 · ADM-BR-09 · AC-A09 · M4-AC12 · admin tắt 2FA hộ (test-plan-cd §2.3, T9d). Xanh ở T9d.
// D-A07: tắt hộ KHÔNG thu hồi phiên (plan-cd §7 "Không thu hồi phiên").
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMark,
  auditSince,
  backupRows,
  createM3Env,
  EXT,
  enable2fa,
  expectErr,
  login,
  type M3Env,
  nextCode,
  PW,
  SEED_PW,
  TENANT_ID,
  totpRow,
  UNKNOWN_ID,
  USER_ID,
} from "./_cd";

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

const off = (token: string, id: string) =>
  env.post(`/admin/users/${id}/totp/disable`, { token, body: {} });

/** Quét đệ quy: tên khoá cấm trong JSON trả về. */
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) keysOf(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
}

describe("ADM-FR-08 · POST /admin/users/:id/totp/disable", () => {
  it("ADM-FR-08 · D-A01 · Q10 · platform admin tắt hộ binh → 200 User totp_enabled false; DB xoá; audit delete; binh login thẳng TokenGrant", async () => {
    await enable2fa(env, "acme", "binh", PW);
    const mark = await auditMark(env);
    const res = await off(await env.admin(), USER_ID.binh);
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(USER_ID.binh);
    expect(res.json.totp_enabled).toBe(false);
    expect(await totpRow(env, USER_ID.binh)).toBeUndefined();
    expect(await backupRows(env, USER_ID.binh)).toHaveLength(0);
    const [adminRow] = await env.owner`select id from admin.users where username = 'admin'`;
    const rows = await auditSince(env, mark);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "delete",
      entity: "user_totp",
      entity_id: USER_ID.binh,
      tenant_id: TENANT_ID.acme,
      actor_id: adminRow?.id,
      before: { enabled: true, backup_codes_left: 10 },
      after: null,
    });
    const l = await login(env, "acme", "binh", PW);
    expect(l.status).toBe(200);
    expect(l.json.status).toBe("authenticated");
  });

  it("ADM-FR-08 · D-A02 · ADM-BR-09 · AC-A09 · binh → chi 200; binh → hoa (globex) 404, hàng của hoa còn; binh → UNKNOWN_ID 404", async () => {
    await enable2fa(env, "acme", "chi", PW);
    await enable2fa(env, "globex", "hoa", PW);
    const binh = await env.token("acme", "binh");
    expect((await off(binh, USER_ID.chi)).status).toBe(200);
    expectErr(await off(binh, USER_ID.hoa), "NOT_FOUND");
    expect(await totpRow(env, USER_ID.hoa)).toBeDefined();
    expect((await totpRow(env, USER_ID.hoa)).enabled_at).not.toBeNull();
    expectErr(await off(binh, UNKNOWN_ID), "NOT_FOUND");
  });

  it("ADM-FR-08 · D-A03 · tắt hộ chính mình → 403 SELF_ACTION_FORBIDDEN (binh, admin)", async () => {
    await enable2fa(env, "acme", "binh", PW);
    await enable2fa(env, "platform", "admin", SEED_PW);
    expectErr(await off(await env.token("acme", "binh"), USER_ID.binh), "SELF_ACTION_FORBIDDEN");
    const [adminRow] = await env.owner`select id from admin.users where username = 'admin'`;
    expectErr(await off(await env.admin(), adminRow?.id as string), "SELF_ACTION_FORBIDDEN");
  });

  it("ADM-FR-08 · D-A04 · target chưa bật (an) → 409 TOTP_NOT_ENABLED", async () => {
    expectErr(await off(await env.token("acme", "binh"), USER_ID.an), "TOTP_NOT_ENABLED");
  });

  it("ADM-FR-08 · D-A05 · M4-AC12 · member (an) tắt hộ chi → 403 FORBIDDEN", async () => {
    await enable2fa(env, "acme", "chi", PW);
    expectErr(await off(await env.token("acme", "an"), USER_ID.chi), "FORBIDDEN");
    expect(await totpRow(env, USER_ID.chi)).toBeDefined();
  });

  it("ADM-FR-08 · D-A06 · ADM-BR-04 · GET /admin/users và /:id có totp_enabled đúng; không khoá secret/hash", async () => {
    await enable2fa(env, "acme", "chi", PW);
    const token = await env.token("acme", "binh");
    const list = await env.get("/admin/users", { token });
    expect(list.status).toBe(200);
    const items = list.json.items as Array<{ id: string; totp_enabled: boolean }>;
    expect(items.find((u) => u.id === USER_ID.chi)?.totp_enabled).toBe(true);
    expect(items.find((u) => u.id === USER_ID.an)?.totp_enabled).toBe(false);
    const one = await env.get(`/admin/users/${USER_ID.chi}`, { token });
    expect(one.status).toBe(200);
    expect(one.json.totp_enabled).toBe(true);
    const keys = keysOf([list.json, one.json]);
    for (const k of keys) expect(/totp_secret|secret_ct|backup|code_hash/.test(k)).toBe(false);
  });

  it("ADM-FR-08 · D-A07 · plan §7 giữ phiên · tắt hộ không thu hồi: access token cũ /auth/me 200; refresh token cũ → 200 TokenGrant mới", async () => {
    const e = await enable2fa(env, "acme", "binh", PW);
    const tok = (await login(env, "acme", "binh", PW)).json.totp_token as string;
    const code = nextCode(env, e.secret);
    const s = await env.post("/auth/totp/verify", {
      body: { totp_token: tok, code },
      headers: EXT,
    });
    expect(s.status).toBe(200);
    const access = s.json.access_token as string;
    const refresh = s.json.refresh_token as string;
    expect(typeof refresh).toBe("string");
    expect((await off(await env.admin(), USER_ID.binh)).status).toBe(200);
    expect((await env.get("/auth/me", { token: access })).status).toBe(200);
    const r = await env.post("/auth/refresh", { headers: EXT, body: { refresh_token: refresh } });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("authenticated");
    expect(typeof r.json.access_token).toBe("string");
  });
});
