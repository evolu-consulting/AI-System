// TK1 · DB test: bản sao template đã migrate + helper chạy "đúng đường chạy thật" (role gói / scope Hub). Bọc `@ai/db/test-db`.
import { cloneMigratedTestDb, migrateAdminTest, migrateFullTest } from "@ai/db/test-db";
import postgres from "postgres";
import { urls } from "./env";

export type Sql = postgres.Sql;
export type Template = "admin" | "full";

/** `admin` = Admin; `full` = Admin + Hub + gói (có `pkdemo`, `contracts`). Mẫu dựng một lần, clone mỗi lần gọi. */
export async function cloneDb(template: Template = "full"): Promise<void> {
  const migrate = template === "admin" ? migrateAdminTest : migrateFullTest;
  await cloneMigratedTestDb(template === "admin" ? urls().admin : urls().owner, {
    key: template === "admin" ? "admin" : "full",
    migrate,
  });
}

/** Kết nối owner (bỏ RLS) để dựng dữ liệu. */
export const openOwner = (max = 4, template: Template = "full"): Sql =>
  postgres(template === "admin" ? urls().admin : urls().owner, { max, onnotice: () => {} });
const hubConn = (): Sql => postgres(urls().hubApi, { max: 1, onnotice: () => {} });

/**
 * MỘT câu đặt nhiều biến tx-local. Tên biến đi qua tham số: review N1 m-01 chỉ cho `packages/db/src/*-scope.ts` viết literal
 * role/tenant; kit cần đường "sai" (tenant rỗng/thiếu) mà `withPackScope` từ chối nên không dùng lại được helper đó.
 */
async function setConfigs(tx: Sql, vars: Record<string, string>): Promise<void> {
  const names = Object.keys(vars);
  const values = names.map((k) => vars[k] as string);
  await tx`select set_config(t.k, t.v, true) from unnest(${names}::text[], ${values}::text[]) as t(k, v)`;
}
const enter = (tx: Sql, role: string, tenantId: string | null): Promise<void> =>
  setConfigs(tx, { role, ...(tenantId === null ? {} : { "app.tenant_id": tenantId }) });

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
 * Tx của `hub_api` đã đặt role + `app.tenant_id` (một câu, như `withPackScope`).
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
      await enter(tx as unknown as Sql, role, tenantId);
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

/**
 * Như `asRole` nhưng GIỮ kết nối `hub_api` giữa các lần gọi (đo perf không tính chi phí mở kết nối; vòng lặp nhiều lần gọi nhanh hơn).
 * Nhớ `close()`.
 */
export function rolePool(max = 2): {
  inPack: <R>(key: string, tenantId: string | null, fn: (tx: Sql) => Promise<R>) => Promise<R>;
  client: Sql;
  close: () => Promise<void>;
} {
  const client = postgres(urls().hubApi, { max, onnotice: () => {} });
  return {
    client,
    inPack: async (key, tenantId, fn) =>
      (await client.begin(async (tx) => {
        await enter(tx as unknown as Sql, `${key}_rw`, tenantId);
        return fn(tx as unknown as Sql);
      })) as Awaited<ReturnType<typeof fn>>,
    close: () => client.end({ timeout: 1 }),
  };
}

/** Như `asRole` với role gói `<key>_rw`. */
export const inPack = <R>(
  key: string,
  tenantId: string | null,
  fn: (tx: Sql) => Promise<R>,
  opts: { rollback?: boolean } = {},
): Promise<R> => asRole(`${key}_rw`, tenantId, fn, opts);

/**
 * M1D · như `inPack` nhưng đặt thêm `app.user_id` (đúng `withPackScope` của request người dùng) ⇒ luật thấy theo người áp dụng.
 * `userId = ""` = việc nền (thấy cả tenant).
 */
export async function inPackAs<R>(
  key: string,
  tenantId: string,
  userId: string,
  fn: (tx: Sql) => Promise<R>,
  opts: { rollback?: boolean } = {},
): Promise<R> {
  const conn = hubConn();
  try {
    return (await conn.begin(async (tx) => {
      await setConfigs(tx as unknown as Sql, {
        role: `${key}_rw`,
        "app.tenant_id": tenantId,
        "app.user_id": userId,
      });
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
        await setConfigs(tx as unknown as Sql, {
          "app.scope": scope.kind,
          "app.tenant_id": tid,
          "app.user_id": uid,
        });
      }
      return fn(tx as unknown as Sql);
    })) as R;
  } finally {
    await conn.end({ timeout: 1 });
  }
}
