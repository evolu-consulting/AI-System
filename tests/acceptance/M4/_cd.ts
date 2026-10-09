// ADM-FR-08, ADM-FR-54 · hạ tầng test int khối C + D (test-plan-cd §0): bọc env M3 (DB test, app thật, clock giả),
// bật 2FA qua API, bước TOTP khi đăng nhập, đọc DB bằng owner, bắt log, checksum bảng, gọi import/export.
// Không chứa `it(...)`. Truy vấn bảng M4 (audit_log, user_totp…) chịu được bảng chưa có để ca đỏ ở route/expect,
// không đỏ ở dựng dữ liệu (CONVENTIONS §2 Test "Bẫy đã gặp").
import { expect } from "bun:test";
import { API_ERRORS } from "@ai/contracts";
import type { M3Env, Res } from "../M3/_fixtures";
import { stepOf, totpAt } from "./_totp";

export * from "../M3/_fixtures";
export { track } from "../M3/_notify";

export const PREFIX = "[M4-qc]";

// biome-ignore lint/suspicious/noExplicitAny: hàng DB đọc bằng owner (bảng M4 chưa có kiểu ở Q2)
export type Row = Record<string, any>;

/** Mã lỗi mới khối C + D (plan-cd §4.3) — chưa có trong `API_ERRORS` ở Q2 (T7 thêm). */
const NEW_CODES: Record<string, number> = {
  PAYLOAD_TOO_LARGE: 413,
  IMPORT_INVALID: 400,
  SECRETS_REQUIRED: 400,
  INVALID_TOTP_TOKEN: 401,
  INVALID_OTP: 401,
  INVALID_CURRENT_CODE: 400,
  TOTP_ALREADY_ENABLED: 409,
  TOTP_NOT_ENABLED: 409,
  TOTP_SETUP_EXPIRED: 409,
};

/** Như `expectErr` M1/M2 nhưng nhận cả mã mới C + D (status theo plan-cd §4.3). Ghi đè bản `export *`. */
export function expectErr(res: Res, code: string): void {
  const status = (API_ERRORS as Record<string, number>)[code] ?? NEW_CODES[code];
  expect(status).toBeDefined();
  expect(res.status).toBe(status as number);
  expect(res.json?.error?.code).toBe(code);
  expect(res.headers.get("x-request-id")).toBeTruthy();
}
export const ACME_LABEL = "acme · binh";

/** Giây unix của clock giả. */
export const nowS = (env: M3Env): number => Math.floor(env.clock.now().getTime() / 1000);

/** Sang bước TOTP kế (clock +30 s) và trả mã của bước mới — chống dùng lại không chặn nhầm. */
export function nextCode(env: M3Env, secret: string): string {
  env.clock.advance(30_000);
  return totpAt(secret, nowS(env));
}

export type Enabled = { secret: string; backupCodes: string[]; step: number; token: string };

/**
 * Bật 2FA cho user qua API (setup → enable bằng mã của clock hiện tại). Gọi TRONG thân `it` (có expect status) để
 * ca đỏ đỏ ở route chưa có, không đỏ trong `beforeAll`.
 */
export async function enable2fa(
  env: M3Env,
  tenant: string,
  username: string,
  pw: string,
): Promise<Enabled> {
  const token = await env.token(tenant, username);
  const s = await env.post("/auth/totp/setup", { token, body: { current_password: pw } });
  expect(s.status).toBe(200);
  const secret = s.json.secret as string;
  const step = stepOf(nowS(env));
  const e = await env.post("/auth/totp/enable", {
    token,
    body: { code: totpAt(secret, nowS(env)) },
  });
  expect(e.status).toBe(200);
  return { secret, backupCodes: e.json.backup_codes as string[], step, token };
}

export const login = (
  env: M3Env,
  tenant: string,
  username: string,
  password: string,
  headers?: Record<string, string>,
): Promise<Res> =>
  env.post("/auth/login", { body: { tenant_key: tenant, username, password }, headers });

/** Đăng nhập mật khẩu đúng của user đã bật 2FA → `totp_token` (kiểm status `totp_required`). */
export async function totpToken(
  env: M3Env,
  tenant: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await login(env, tenant, username, password);
  expect(res.status).toBe(200);
  expect(res.json.status).toBe("totp_required");
  return res.json.totp_token as string;
}

export const verify = (env: M3Env, body: unknown, headers?: Record<string, string>): Promise<Res> =>
  env.post("/auth/totp/verify", { body, headers });

// ---------- DB (owner) ----------
async function exists(env: M3Env, rel: string): Promise<boolean> {
  const [r] = await env.owner<{ x: string | null }[]>`select to_regclass(${rel})::text as x`;
  return Boolean(r?.x);
}

export async function userRow(env: M3Env, id: string) {
  const [r] = await env.owner`select failed_logins, locked_until, last_login_at, active
    from admin.users where id = ${id}`;
  return r as {
    failed_logins: number;
    locked_until: Date | null;
    last_login_at: Date | null;
    active: boolean;
  };
}

export async function totpRow(env: M3Env, userId: string): Promise<Row> {
  const [r] = await env.owner`select * from admin.user_totp where user_id = ${userId}`;
  return r as Row;
}

export const backupRows = (env: M3Env, userId: string) =>
  env.owner`select code_hash, used_at from admin.user_backup_codes where user_id = ${userId}`;

/** `seq` lớn nhất của audit_log (0 khi bảng chưa có — T1 khối B). */
export async function auditMark(env: M3Env): Promise<number> {
  if (!(await exists(env, "admin.audit_log"))) return 0;
  const [r] = await env.owner<
    { n: string | null }[]
  >`select max(seq)::text as n from admin.audit_log`;
  return Number(r?.n ?? 0);
}

/** Hàng audit_log có `seq > mark` ([] khi bảng chưa có — T1 khối B). */
export async function auditSince(env: M3Env, mark: number): Promise<Row[]> {
  if (!(await exists(env, "admin.audit_log"))) return [];
  return [...(await env.owner`select * from admin.audit_log where seq > ${mark} order by seq`)];
}

/** md5 từng bảng `admin.*` (owner) — so trước/sau để chứng minh "không ghi gì". */
export async function checksumAdmin(env: M3Env): Promise<Record<string, string>> {
  const tables = await env.owner<
    { t: string }[]
  >`select table_name as t from information_schema.tables
    where table_schema = 'admin' and table_type = 'BASE TABLE' order by 1`;
  const out: Record<string, string> = {};
  for (const { t } of tables) {
    const [r] = await env.owner.unsafe(
      `select coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as h from admin."${t}" x`,
    );
    out[t] = String((r as unknown as { h: string }).h);
  }
  return out;
}

// ---------- log ----------
export type Captured = { text: () => string; restore: () => void };

/** Bắt mọi thứ ghi ra stdout/stderr/console trong lúc chạy ca (test-plan-cd §0 "Rò rỉ"). */
export function captureLogs(): Captured {
  const chunks: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const saved = methods.map((m) => console[m]);
  const grab = (x: unknown) => {
    chunks.push(typeof x === "string" ? x : Buffer.isBuffer(x) ? x.toString("utf8") : String(x));
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  for (const m of methods) {
    console[m] = (...a: unknown[]) => {
      chunks.push(a.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" "));
    };
  }
  return {
    text: () => chunks.join("\n"),
    restore: () => {
      process.stdout.write = out;
      process.stderr.write = err;
      methods.forEach((m, i) => {
        console[m] = saved[i] as (typeof console)[typeof m];
      });
    },
  };
}

// ---------- Import / Export ----------
export const exportReq = async (env: M3Env, query: string, token?: string): Promise<Res> =>
  env.get(`/admin/export${query}`, { token: token ?? (await env.admin()) });

export const importReq = async (
  env: M3Env,
  body: unknown,
  dryRun?: "1" | "0",
  token?: string,
): Promise<Res> =>
  env.post(`/admin/import${dryRun === undefined ? "" : `?dry_run=${dryRun}`}`, {
    token: token ?? (await env.admin()),
    body,
  });
