// ADM-FR-08 · M4-R16 · M4-AC11 · M4-AC12 · bật/tắt 2FA, mã dự phòng (test-plan-cd §2.1, T9b). Xanh ở T9b.
// Chống dùng lại: mỗi mã mới lấy bằng `nextCode` (clock giả +30 s). `enable2fa` gọi trong thân `it`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  ACME_LABEL,
  auditMark,
  auditSince,
  backupRows,
  createM3Env,
  enable2fa,
  expectErr,
  type Listener,
  type M3Env,
  nextCode,
  nowS,
  PW,
  SEED_PW,
  TENANT_ID,
  totpRow,
  totpToken,
  track,
  USER_ID,
  userRow,
  verify,
} from "./_cd";
import { stepOf, totpAt, unb32, wrongCodeAt } from "./_totp";

let env: M3Env;
let lis: Listener;
const ALPHA = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_RE = new RegExp(`^[${ALPHA}]{4}-[${ALPHA}]{4}$`);

beforeAll(async () => {
  env = await createM3Env();
  lis = await env.listen();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset3();
});

const binh = () => env.token("acme", "binh");
const post = async (path: string, body: unknown, token?: string) =>
  env.post(path, { token: token ?? (await binh()), body });
const setup = (pw = PW, token?: string) =>
  post("/auth/totp/setup", { current_password: pw }, token);
const enable = (code: string, token?: string) => post("/auth/totp/enable", { code }, token);
const wrong = (secret: string) => wrongCodeAt(secret, nowS(env));

describe("ADM-FR-08 · setup", () => {
  it("ADM-FR-08 · D-S01 · setup trả secret/otpauth/qr/nhãn, no-store; DB pending 600 s, secret mã hoá (không chứa 20 byte thô)", async () => {
    const res = await setup();
    expect(res.status).toBe(200);
    expect(res.json.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.json.otpauth_url).toContain("secret=");
    expect(res.json.qr_svg.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(res.json.account_label).toBe(ACME_LABEL);
    expect(res.json.expires_in).toBe(600);
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
    const row = await totpRow(env, USER_ID.binh);
    expect(row.enabled_at).toBeNull();
    expect(new Date(row.pending_expires_at).getTime()).toBe(env.clock.now().getTime() + 600_000);
    expect(row.secret_ct.length).toBe(36);
    expect(row.secret_iv.length).toBe(12);
    expect(row.key_version).toBe(1);
    expect(Buffer.from(row.secret_ct).indexOf(Buffer.from(unb32(res.json.secret)))).toBe(-1);
  });

  it("ADM-FR-08 · D-S02 · ADM-FR-07 · setup sai mật khẩu ×5 → 400 (bộ đếm 1..4; lần 5 khoá +15', bộ đếm 0); lần 6 đúng → 423 TEMP_LOCKED", async () => {
    for (let i = 1; i <= 4; i++) {
      expectErr(await setup("Wrong-Passw0rd-9"), "INVALID_CURRENT_PASSWORD");
      const r = await userRow(env, USER_ID.binh);
      expect(r.failed_logins).toBe(i);
      expect(r.locked_until).toBeNull();
    }
    expectErr(await setup("Wrong-Passw0rd-9"), "INVALID_CURRENT_PASSWORD");
    const locked = await userRow(env, USER_ID.binh);
    expect(locked.failed_logins).toBe(0);
    expect(new Date(locked.locked_until as Date).toISOString()).toBe("2026-10-01T09:15:00.000Z");
    const res = await setup();
    expectErr(res, "TEMP_LOCKED");
    expect(res.json.error.details.until).toBe("2026-10-01T09:15:00.000Z");
  });

  it("ADM-FR-08 · D-S03 · setup lại thay pending cũ: mã của S1 → 400 INVALID_CURRENT_CODE, mã S2 → 200", async () => {
    const s1 = (await setup()).json.secret as string;
    const r2 = await setup();
    expect(r2.status).toBe(200);
    const s2 = r2.json.secret as string;
    expect(s1).not.toBe(s2);
    expectErr(await enable(totpAt(s1, nowS(env))), "INVALID_CURRENT_CODE");
    expect((await enable(totpAt(s2, nowS(env)))).status).toBe(200);
  });

  it("ADM-FR-08 · D-S04 · R16 · enable khi chưa setup / pending quá 600 s → 409 TOTP_SETUP_EXPIRED", async () => {
    expectErr(await enable("123456"), "TOTP_SETUP_EXPIRED");
    const s = (await setup()).json.secret as string;
    env.clock.advance(601_000);
    expectErr(await enable(totpAt(s, nowS(env))), "TOTP_SETUP_EXPIRED");
  });

  it("ADM-FR-08 · D-S05 · R16 · enable sai mã ×6 → 400 ×6, failed_logins KHÔNG đổi, không 423", async () => {
    const s = await setup();
    expect(s.status).toBe(200);
    for (let i = 0; i < 6; i++)
      expectErr(await enable(wrong(s.json.secret)), "INVALID_CURRENT_CODE");
    expect((await userRow(env, USER_ID.binh)).failed_logins).toBe(0);
  });

  it("ADM-FR-08 · D-S06 · M4-AC11 · enable đúng → 10 mã dự phòng (no-store); DB enabled, last_used_step, 10 hash HMAC 32 byte", async () => {
    const s = await setup();
    expect(s.status).toBe(200);
    const res = await enable(totpAt(s.json.secret, nowS(env)));
    expect(res.status).toBe(200);
    const codes = res.json.backup_codes as string[];
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(CODE_RE);
    expect(new Set(codes).size).toBe(10);
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
    const row = await totpRow(env, USER_ID.binh);
    expect(new Date(row.enabled_at).getTime()).toBe(env.clock.now().getTime());
    expect(row.pending_expires_at).toBeNull();
    expect(Number(row.last_used_step)).toBe(stepOf(nowS(env)));
    const rows = await backupRows(env, USER_ID.binh);
    expect(rows).toHaveLength(10);
    const sha = (x: string) => createHash("sha256").update(x).digest("hex");
    const forbidden = new Set(codes.flatMap((c) => [sha(c), sha(c.replace("-", ""))]));
    for (const r of rows) {
      const h = Buffer.from(r.code_hash);
      expect(h.length).toBe(32);
      expect(r.used_at).toBeNull();
      expect(forbidden.has(h.toString("hex"))).toBe(false);
      for (const c of codes) expect(h.toString("latin1")).not.toContain(c.replace("-", ""));
    }
  });

  it("ADM-FR-08 · D-S07 · đã bật: setup và enable → 409 TOTP_ALREADY_ENABLED", async () => {
    const e = await enable2fa(env, "acme", "binh", PW);
    expectErr(await setup(), "TOTP_ALREADY_ENABLED");
    expectErr(await enable(nextCode(env, e.secret)), "TOTP_ALREADY_ENABLED");
  });

  it("ADM-FR-08 · D-S08 · /auth/me: {false,null,0} → {true, clock ISO, 10} → dùng 1 mã dự phòng → 9", async () => {
    const me = async () => (await env.get("/auth/me", { token: await binh() })).json;
    expect(await me()).toMatchObject({
      totp_enabled: false,
      totp_enabled_at: null,
      backup_codes_left: 0,
    });
    const e = await enable2fa(env, "acme", "binh", PW);
    expect(await me()).toMatchObject({
      totp_enabled: true,
      totp_enabled_at: env.clock.now().toISOString(),
      backup_codes_left: 10,
    });
    const tok = await totpToken(env, "acme", "binh", PW);
    expect((await verify(env, { totp_token: tok, backup_code: e.backupCodes[0] })).status).toBe(
      200,
    );
    expect((await me()).backup_codes_left).toBe(9);
  });

  it("ADM-FR-08 · D-S09 · M4-R10 · audit: setup 0 dòng; enable đúng 1 dòng create user_totp; không bump, 0 NOTIFY", async () => {
    let mark = await auditMark(env);
    let afterSetup: unknown[] = [];
    const t1 = await track(env, lis, async () => {
      const r = await setup();
      if (r.status === 200) afterSetup = [...(await auditSince(env, mark))];
      return r;
    });
    expect(t1.res.status).toBe(200);
    expect(afterSetup).toHaveLength(0);
    mark = await auditMark(env);
    // biome-ignore lint/suspicious/noExplicitAny: hàng audit_log (owner)
    let rows: any[] = [];
    const t2 = await track(env, lis, async () => {
      const r = await enable(totpAt(t1.res.json.secret, nowS(env)));
      if (r.status === 200) rows = [...(await auditSince(env, mark))];
      return r;
    });
    expect(t2.res.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "create",
      entity: "user_totp",
      entity_id: USER_ID.binh,
      tenant_id: TENANT_ID.acme,
      before: null,
      after: { enabled: true, backup_codes_left: 10 },
    });
    for (const t of [t1, t2]) {
      expect(t.v1).toBe(t.v0);
      expect(t.msgs).toHaveLength(0);
    }
  });
});

describe("ADM-FR-08 · disable + backup-codes", () => {
  const disable = (body: unknown) => post("/auth/totp/disable", body);

  it("ADM-FR-08 · D-S10 · tự tắt: sai mật khẩu 400 (+1), sai mã 400 (+1), đúng 204; DB xoá (cascade), audit delete, me false", async () => {
    const e = await enable2fa(env, "acme", "binh", PW);
    const mark = await auditMark(env);
    const code = nextCode(env, e.secret);
    expectErr(
      await disable({ current_password: "Wrong-Passw0rd-9", code }),
      "INVALID_CURRENT_PASSWORD",
    );
    expect((await userRow(env, USER_ID.binh)).failed_logins).toBe(1);
    expectErr(
      await disable({ current_password: PW, code: wrong(e.secret) }),
      "INVALID_CURRENT_CODE",
    );
    expect((await userRow(env, USER_ID.binh)).failed_logins).toBe(2);
    expect((await disable({ current_password: PW, code })).status).toBe(204);
    expect(await totpRow(env, USER_ID.binh)).toBeUndefined();
    expect(await backupRows(env, USER_ID.binh)).toHaveLength(0);
    const rows = await auditSince(env, mark);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "delete",
      entity: "user_totp",
      entity_id: USER_ID.binh,
      before: { enabled: true, backup_codes_left: 10 },
      after: null,
    });
    const me = await env.get("/auth/me", { token: await binh() });
    expect(me.json.totp_enabled).toBe(false);
  });

  it("ADM-FR-08 · D-S11 · tắt bằng backup_code → 204; tắt khi chưa bật → 409 TOTP_NOT_ENABLED", async () => {
    const e = await enable2fa(env, "acme", "binh", PW);
    expect((await disable({ current_password: PW, backup_code: e.backupCodes[2] })).status).toBe(
      204,
    );
    expectErr(
      await disable({ current_password: PW, code: nextCode(env, e.secret) }),
      "TOTP_NOT_ENABLED",
    );
  });

  it("ADM-FR-08 · D-S12 · Q-D1 · tạo lại mã: sai 400 (+1); đúng → 10 mã mới, mã cũ 401 INVALID_OTP, mã mới 200; audit update; chưa bật 409", async () => {
    const e = await enable2fa(env, "acme", "binh", PW);
    const regen = (code: string) => post("/auth/totp/backup-codes", { code });
    expectErr(await regen(wrong(e.secret)), "INVALID_CURRENT_CODE");
    expect((await userRow(env, USER_ID.binh)).failed_logins).toBe(1);
    const mark = await auditMark(env);
    const res = await regen(nextCode(env, e.secret));
    expect(res.status).toBe(200);
    const fresh = res.json.backup_codes as string[];
    expect(fresh).toHaveLength(10);
    for (const c of fresh) expect(e.backupCodes).not.toContain(c);
    const old = await verify(env, {
      totp_token: await totpToken(env, "acme", "binh", PW),
      backup_code: e.backupCodes[0],
    });
    expectErr(old, "INVALID_OTP");
    const ok = await verify(env, {
      totp_token: await totpToken(env, "acme", "binh", PW),
      backup_code: fresh[0],
    });
    expect(ok.status).toBe(200);
    const rows = (await auditSince(env, mark)).filter((r) => r.entity === "user_totp");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "update",
      before: { backup_codes_left: 10 },
      after: { backup_codes_left: 10 },
    });
    const chi = await env.token("acme", "chi");
    expectErr(await post("/auth/totp/backup-codes", { code: "123456" }, chi), "TOTP_NOT_ENABLED");
  });
});

describe("ADM-FR-08 · quyền + validate", () => {
  it("ADM-FR-08 · D-S13 · M4-AC12 · member gọi setup/enable/disable/backup-codes → 403 ×4; không Bearer → 401", async () => {
    const an = await env.token("acme", "an");
    const calls: Array<[string, unknown]> = [
      ["/auth/totp/setup", { current_password: PW }],
      ["/auth/totp/enable", { code: "123456" }],
      ["/auth/totp/disable", { current_password: PW, code: "123456" }],
      ["/auth/totp/backup-codes", { code: "123456" }],
    ];
    for (const [path, body] of calls) expectErr(await post(path, body, an), "FORBIDDEN");
    expectErr(
      await env.post("/auth/totp/setup", { body: { current_password: PW } }),
      "UNAUTHORIZED",
    );
  });

  it("ADM-FR-08 · D-S14 · enable code 5 số; disable có cả code + backup_code; khoá lạ → 400 VALIDATION_ERROR", async () => {
    const s = await setup();
    expect(s.status).toBe(200);
    expectErr(await enable("12345"), "VALIDATION_ERROR");
    expectErr(
      await post("/auth/totp/disable", {
        current_password: PW,
        code: "123456",
        backup_code: "k7p2-9xqm",
      }),
      "VALIDATION_ERROR",
    );
    expectErr(await post("/auth/totp/enable", { code: "123456", extra: 1 }), "VALIDATION_ERROR");
  });

  it("ADM-FR-08 · D-S15 · platform admin bật được; account_label bắt đầu 'platform · '", async () => {
    const token = await env.admin();
    const s = await setup(SEED_PW, token);
    expect(s.status).toBe(200);
    expect(s.json.account_label.startsWith("platform · ")).toBe(true);
    expect((await enable(totpAt(s.json.secret, nowS(env)), token)).status).toBe(200);
  });
});
