// ADM-FR-08 · ADM-BR-04 · ADM-BR-09 · M4-R10 · bảng `admin.user_totp`, `admin.user_backup_codes` (test-plan-cd §2.4,
// plan-cd §5, T9a): cột/CHECK, RLS theo tenant, hub_ro không đọc được, cascade, không rò secret/mã ra DB và log.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { ADMIN_API_URL } from "../M1/_fixtures";
import {
  captureLogs,
  createM3Env,
  login,
  type M3Env,
  nextCode,
  PW,
  type Sql,
  scanDatabase,
  TENANT_ID,
  totpToken,
  USER_ID,
  verify,
} from "./_cd";

let env: M3Env;
let api: Sql;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;

beforeAll(async () => {
  env = await createM3Env();
  api = postgres(ADMIN_API_URL, { max: 2, onnotice: () => {} });
});
afterAll(async () => {
  await api.end();
  await env.close();
});
beforeEach(async () => {
  await env.reset3();
});

async function sqlstate(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    if (e instanceof Rollback) return null;
    return (e as { code?: string }).code ?? "unknown";
  }
}

/** Transaction có scope (hoặc role), luôn rollback; trả kết quả `fn`. */
async function scoped<T>(
  sql: Sql,
  scope: string | null,
  tid: string | null,
  fn: (tx: Tx) => Promise<T>,
  role?: string,
) {
  let out: T | undefined;
  await sqlstate(() =>
    sql.begin(async (tx) => {
      if (role) await tx.unsafe(`set local role ${role}`);
      if (scope !== null) {
        await tx`select set_config('app.scope', ${scope}, true), set_config('app.tenant_id', ${tid ?? ""}, true)`;
      }
      out = await fn(tx);
      throw new Rollback();
    }),
  );
  return out as T;
}

const ct = (n = 36) => Buffer.alloc(n, 9);
const iv = () => Buffer.alloc(12, 4);
/** Bảng của T9a đã có (expect — để ca đỏ ở expect, không ở PostgresError khi dựng hàng). */
async function expectTables(): Promise<void> {
  const [r] = await env.owner<{ a: string | null; b: string | null }[]>`select
    to_regclass('admin.user_totp')::text as a, to_regclass('admin.user_backup_codes')::text as b`;
  expect([r?.a, r?.b]).toEqual(["admin.user_totp", "admin.user_backup_codes"]);
}
async function seedTotp(userId: string, tenantId: string): Promise<void> {
  await expectTables();
  await env.owner`insert into admin.user_totp (user_id, tenant_id, secret_ct, secret_iv, key_version, enabled_at)
    values (${userId}, ${tenantId}, ${ct()}, ${iv()}, 1, now())`;
  await env.owner`insert into admin.user_backup_codes (tenant_id, user_id, code_hash)
    values (${tenantId}, ${userId}, ${Buffer.alloc(32, 1)})`;
}

describe("ADM-FR-08 · schema user_totp / user_backup_codes", () => {
  it("ADM-FR-08 · D-DB01 · plan §5 · cột/kiểu/null đúng; CHECK secret_ct 35 byte, enabled/pending cùng null, code_hash 31 byte → 23514", async () => {
    const cols = await env.owner<{ t: string; c: string; ty: string; n: string }[]>`
      select table_name as t, column_name as c, data_type as ty, is_nullable as n
      from information_schema.columns where table_schema = 'admin'
        and table_name in ('user_totp', 'user_backup_codes') order by 1, 2`;
    const got = cols.map((r) => `${r.t}.${r.c}:${r.ty}:${r.n}`);
    expect(got).toEqual([
      "user_backup_codes.code_hash:bytea:NO",
      "user_backup_codes.created_at:timestamp with time zone:NO",
      "user_backup_codes.id:uuid:NO",
      "user_backup_codes.tenant_id:uuid:NO",
      "user_backup_codes.used_at:timestamp with time zone:YES",
      "user_backup_codes.user_id:uuid:NO",
      "user_totp.created_at:timestamp with time zone:NO",
      "user_totp.enabled_at:timestamp with time zone:YES",
      "user_totp.key_version:smallint:NO",
      "user_totp.last_used_step:bigint:YES",
      "user_totp.pending_expires_at:timestamp with time zone:YES",
      "user_totp.secret_ct:bytea:NO",
      "user_totp.secret_iv:bytea:NO",
      "user_totp.tenant_id:uuid:NO",
      "user_totp.updated_at:timestamp with time zone:NO",
      "user_totp.user_id:uuid:NO",
    ]);
    const ins = (o: { ct?: Buffer; enabled?: boolean; pending?: boolean }) =>
      sqlstate(
        () =>
          env.owner`insert into admin.user_totp (user_id, tenant_id, secret_ct, secret_iv, key_version,
          enabled_at, pending_expires_at)
          values (${USER_ID.chi}, ${TENANT_ID.acme}, ${o.ct ?? ct()}, ${iv()}, 1,
            ${o.enabled ? new Date() : null}, ${o.pending ? new Date() : null})`,
      );
    expect(await ins({ ct: ct(35), enabled: true })).toBe("23514");
    expect(await ins({})).toBe("23514");
    expect(await ins({ enabled: true, pending: true })).toBe("23514");
    await seedTotp(USER_ID.binh, TENANT_ID.acme);
    const short = await sqlstate(
      () => env.owner`insert into admin.user_backup_codes (tenant_id, user_id, code_hash)
        values (${TENANT_ID.acme}, ${USER_ID.binh}, ${Buffer.alloc(31, 2)})`,
    );
    expect(short).toBe("23514");
  });

  it("ADM-FR-08 · D-DB02 · ADM-BR-09 · admin_api scope globex: 0 hàng của acme; INSERT tenant acme → lỗi RLS", async () => {
    await seedTotp(USER_ID.binh, TENANT_ID.acme);
    const seen = await scoped(api, "tenant", TENANT_ID.globex, async (tx) => [
      (await tx`select count(*)::int as n from admin.user_totp`)[0]?.n,
      (await tx`select count(*)::int as n from admin.user_backup_codes`)[0]?.n,
    ]);
    expect(seen).toEqual([0, 0]);
    const insert = await sqlstate(() =>
      api.begin(async (tx) => {
        await tx`select set_config('app.scope', 'tenant', true), set_config('app.tenant_id', ${TENANT_ID.globex}, true)`;
        await tx`insert into admin.user_totp (user_id, tenant_id, secret_ct, secret_iv, key_version, enabled_at)
          values (${USER_ID.chi}, ${TENANT_ID.acme}, ${ct()}, ${iv()}, 1, now())`;
      }),
    );
    expect(insert).toBe("42501");
  });

  it("ADM-FR-08 · D-DB03 · D1 · M4-R10 · hub_ro SELECT 2 bảng → 42501; has_table_privilege = false", async () => {
    await seedTotp(USER_ID.binh, TENANT_ID.acme);
    for (const t of ["user_totp", "user_backup_codes"]) {
      const st = await sqlstate(() =>
        env.owner.begin(async (tx) => {
          await tx.unsafe("set local role hub_ro");
          await tx.unsafe(`select * from admin.${t}`);
        }),
      );
      expect(st).toBe("42501");
      const [p] = await env.owner<
        { ok: boolean }[]
      >`select has_table_privilege('hub_ro', ${`admin.${t}`}, 'SELECT') as ok`;
      expect(p?.ok).toBe(false);
    }
  });

  it("ADM-FR-08 · D-DB04 · owner xoá user có 2FA → hàng user_totp, user_backup_codes biến mất (FK cascade)", async () => {
    await seedTotp(USER_ID.lan, TENANT_ID.acme);
    await env.owner`delete from admin.group_members where user_id = ${USER_ID.lan}`;
    await env.owner`delete from admin.users where id = ${USER_ID.lan}`;
    const [a] =
      await env.owner`select count(*)::int as n from admin.user_totp where user_id = ${USER_ID.lan}`;
    const [b] =
      await env.owner`select count(*)::int as n from admin.user_backup_codes where user_id = ${USER_ID.lan}`;
    expect([a?.n, b?.n]).toEqual([0, 0]);
  });
});

type Flow = {
  secret: string;
  otpauth: string;
  qr: string;
  codes: string[];
  sent: string[];
  token: string;
};

/** setup → enable → login + verify → tạo lại mã → (tuỳ chọn) tắt; gom mọi giá trị nhạy cảm đã thấy. */
async function fullFlow(withDisable: boolean): Promise<Flow> {
  const binh = await env.token("acme", "binh");
  const s = await env.post("/auth/totp/setup", { token: binh, body: { current_password: PW } });
  expect(s.status).toBe(200);
  const secret = s.json.secret as string;
  const sent: string[] = [];
  const c1 = nextCode(env, secret);
  sent.push(c1);
  const e = await env.post("/auth/totp/enable", { token: binh, body: { code: c1 } });
  expect(e.status).toBe(200);
  const token = await totpToken(env, "acme", "binh", PW);
  const c2 = nextCode(env, secret);
  sent.push(c2);
  expect((await verify(env, { totp_token: token, code: c2 })).status).toBe(200);
  const c3 = nextCode(env, secret);
  sent.push(c3);
  const r = await env.post("/auth/totp/backup-codes", { token: binh, body: { code: c3 } });
  expect(r.status).toBe(200);
  const codes = [...(e.json.backup_codes as string[]), ...(r.json.backup_codes as string[])];
  if (withDisable) {
    const d = await env.post("/auth/totp/disable", {
      token: binh,
      body: { current_password: PW, backup_code: r.json.backup_codes[0] },
    });
    expect(d.status).toBe(204);
  }
  return { secret, otpauth: s.json.otpauth_url, qr: s.json.qr_svg, codes, sent, token };
}

describe("ADM-FR-08 · không rò (ADM-BR-04)", () => {
  it("ADM-FR-08 · D-DB05 · BR-04 · sau bật + đăng nhập + tạo lại mã: secret, mã dự phòng, totp_token, otpauth_url không có trong DB (kể cả audit_log)", async () => {
    const f = await fullFlow(false);
    const forms = [
      f.secret,
      f.otpauth,
      f.token,
      ...f.codes,
      ...f.codes.map((c) => c.replace("-", "")),
    ];
    expect(await scanDatabase(env.owner, forms)).toEqual([]);
  });

  it("ADM-FR-08 · D-DB06 · BR-04 · log quanh setup/enable/verify/backup-codes/disable không chứa secret, otpauth, qr, mã, totp_token, mật khẩu", async () => {
    await env.token("acme", "binh");
    await login(env, "acme", "an", PW);
    const cap = captureLogs();
    let f: Flow;
    try {
      f = await fullFlow(true);
    } finally {
      cap.restore();
    }
    const log = cap.text();
    const forms = [f.secret, f.otpauth, f.qr.slice(26, 90), f.token, PW, ...f.sent, ...f.codes];
    for (const x of forms) expect(log.includes(x)).toBe(false);
  });
});
