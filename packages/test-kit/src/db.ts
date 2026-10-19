// TK1 · DB test: bản sao template đã migrate + helper chạy "đúng đường chạy thật" (role gói / scope Hub). Bọc `@ai/db/test-db`.
import { cloneMigratedTestDb, migrateAdminTest, migrateFullTest } from "@ai/db/test-db";
import postgres from "postgres";
import { urls } from "./env";

export type Sql = postgres.Sql;
export type Template = "admin" | "full";

/** `admin` = Admin; `full` = Admin + Hub + gói (có `pkdemo`, `contracts`). Mẫu dựng một lần, clone mỗi lần gọi. */
export async function cloneDb(template: Template = "full"): Promise<void> {
  const migrate = template === "admin" ? migrateAdminTest : migrateFullTest;
  await cloneMigratedTestDb(urls().owner, {
    key: template === "admin" ? "admin" : "full",
    migrate,
  });
}

/** Kết nối owner (bỏ RLS) để dựng dữ liệu. */
export const openOwner = (max = 4): Sql => postgres(urls().owner, { max, onnotice: () => {} });
const hubConn = (): Sql => postgres(urls().hubApi, { max: 1, onnotice: () => {} });

class Rollback {
  constructor(readonly value: unknown) {}
}

/** Mã SQLSTATE của lỗi `fn` ném (hoặc null nếu không lỗi). */
export async function pgCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? `no-code:${(e as Error).message}`;
  }
}

/**
 * Tx của `hub_api` đã `set_config('role', <role>)` + `app.tenant_id` (đúng `withPackScope`).
 * `tenantId = null` KHÔNG đặt biến (fail-closed). `rollback` luôn hoàn tác, trả kết quả của `fn`.
 */
export async function asRole<R>(
  role: string,
  tenantId: string | null,
  fn: (tx: Sql) => Promise<R>,
  opts: { rollback?: boolean } = {},
): Promise<R> {
  const conn = hubConn();
  try {
    return (await conn.begin(async (tx) => {
      await tx`select set_config('role', ${role}, true)`;
      if (tenantId !== null) await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      const out = await fn(tx as unknown as Sql);
      if (opts.rollback) throw new Rollback(out);
      return out;
    })) as R;
  } catch (e) {
    if (e instanceof Rollback) return e.value as R;
    throw e;
  } finally {
    await conn.end({ timeout: 1 });
  }
}

/** Như `asRole` với role gói `<key>_rw`. */
export const inPack = <R>(
  key: string,
  tenantId: string | null,
  fn: (tx: Sql) => Promise<R>,
  opts: { rollback?: boolean } = {},
): Promise<R> => asRole(`${key}_rw`, tenantId, fn, opts);

export type HubScopeArg = { kind: "system" } | { kind: "user"; tenantId: string; userId: string };
/** Tx của `hub_api` với `app.scope` (đúng `withHubScope`); `"none"` = không đặt gì (fail-closed). */
export async function inHub<R>(
  scope: HubScopeArg | "none",
  fn: (tx: Sql) => Promise<R>,
): Promise<R> {
  const conn = hubConn();
  try {
    return (await conn.begin(async (tx) => {
      if (scope !== "none") {
        const tid = scope.kind === "user" ? scope.tenantId : "";
        const uid = scope.kind === "user" ? scope.userId : "";
        await tx`select set_config('app.scope', ${scope.kind}, true), set_config('app.tenant_id', ${tid}, true),
          set_config('app.user_id', ${uid}, true)`;
      }
      return fn(tx as unknown as Sql);
    })) as R;
  } finally {
    await conn.end({ timeout: 1 });
  }
}
