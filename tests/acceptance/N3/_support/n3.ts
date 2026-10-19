// N3-FR-01…09 · hạ tầng int N3: DB sạch X2a (fixture H1 + user X2a, DB clone mẫu `test:int:par`), kết nối `hub_api` thật
// (đúng đường chạy: gói = `set_config('role','<k>_rw')`; Hub = `app.scope`), chèn dữ liệu bằng owner (bỏ RLS). Không `it(...)`.
import { expect } from "bun:test";
import postgres from "postgres";
import { HUB_API_URL, type Sql, T } from "../../H1/_fixtures";
import { P, setupX2a } from "../../X2a/_x2a";

export type { Sql };
export { HUB_API_URL, P, setupX2a, T };

/** Hàm `notify.enqueue` + bảng N3 đã có trong DB mẫu. Đỏ NGAY với lý do rõ (không PostgresError trong fixture). */
export async function needNotify(sql: Sql): Promise<void> {
  const [r] = await sql<{ ok: boolean }[]>`select
    to_regclass('hub.notifications') is not null and to_regclass('hub.notification_deliveries') is not null
    and to_regclass('hub.notify_prefs') is not null and to_regclass('hub.push_subscriptions') is not null
    and to_regprocedure('notify.enqueue(text,jsonb)') is not null as ok`;
  expect({ n3_migrations: r?.ok === true }).toEqual({ n3_migrations: true });
}

const hubConn = (): Sql => postgres(HUB_API_URL, { max: 1, onnotice: () => {} });

/** Tx của `hub_api` đã `SET ROLE <k>_rw` + tenant (đúng `withPackScope`). `tenantId=null` = không đặt `app.tenant_id`. */
export async function inPack<R>(
  key: string,
  tenantId: string | null,
  fn: (tx: Sql) => Promise<R>,
  opts: { rollback?: boolean } = {},
): Promise<R> {
  const conn = hubConn();
  try {
    return (await conn.begin(async (tx) => {
      await tx`select set_config('role', ${`${key}_rw`}, true)`;
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
class Rollback {
  constructor(readonly value: unknown) {}
}

export type HubScopeArg = { kind: "system" } | { kind: "user"; tenantId: string; userId: string };
/** Tx của `hub_api` với `app.scope` (đúng `withHubScope`); `none` = không đặt gì (fail-closed). */
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

/** Mã SQLSTATE của lỗi `fn` ném (hoặc null). */
export async function pgCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? `no-code:${(e as Error).message}`;
  }
}

export type Notice = {
  user_id: string;
  kind?: string;
  title?: string;
  body?: string;
  link?: string;
  dedup_key?: string;
};
export const notice = (user_id: string, o: Partial<Notice> = {}): Notice => ({
  user_id,
  kind: "demo.note",
  title: "Tiêu đề",
  ...o,
});

/** Gọi hàm cổng trong tx của gói; trả số hàng mới. */
export async function enqueue(tx: Sql, source: string, rows: Notice[]): Promise<number> {
  const [r] = await tx<
    { n: number }[]
  >`select notify.enqueue(${source}, ${tx.json(rows as never)}) as n`;
  return r?.n ?? -1;
}

export async function resetNotify(sql: Sql): Promise<void> {
  await sql`truncate hub.notification_deliveries, hub.notifications, hub.notify_prefs, hub.push_subscriptions`;
}

// ---------- worker (dispatch) ----------
import { connectDb } from "../../../../apps/hub-api/src/lib/db";
import { dispatchRepo } from "../../../../apps/hub-api/src/modules/notify/adapters/dispatch.repo";
import {
  FakeEmailTransport,
  FakePushTransport,
} from "../../../../apps/hub-api/src/modules/notify/adapters/transport.fake";
import {
  type DispatchDeps,
  drain,
} from "../../../../apps/hub-api/src/modules/notify/application/dispatch.usecase";

export type Worker = {
  db: ReturnType<typeof connectDb>;
  email: FakeEmailTransport;
  push: FakePushTransport;
  deps: DispatchDeps;
  /** Đồng hồ giả: đặt/tiến thời gian, không sleep. */
  clock: { ms: number; advance(sec: number): void };
  /** Số câu SQL (trừ điều khiển tx + set_config scope) pool gửi trong `fn`. */
  count<R>(fn: () => Promise<R>): Promise<{ n: number; queries: string[]; r: R }>;
  stop(): Promise<void>;
};

const TX_CTL =
  /^\s*((begin|commit|rollback)\b|select set_config\('app\.scope'|select b\.oid, b\.typarray)/i;

/** Worker thật (pool `hub_api`) + transport giả + đồng hồ giả bắt đầu 2030-01-01. */
export function startWorker(o: { batchSize?: number } = {}): Worker {
  const db = connectDb(HUB_API_URL, 6);
  const email = new FakeEmailTransport();
  const push = new FakePushTransport();
  const clock = {
    ms: Date.parse("2030-01-01T00:00:00Z"),
    advance(sec: number) {
      this.ms += sec * 1000;
    },
  };
  const deps: DispatchDeps = {
    store: dispatchRepo(db),
    email,
    push,
    now: () => new Date(clock.ms),
    baseUrl: "https://app.example",
    ...(o.batchSize ? { batchSize: o.batchSize } : {}),
  };
  type Pool = { options: { debug?: (c: number, q: string) => void } };
  const pool = (db.db as unknown as { $client: Pool }).$client;
  return {
    db,
    email,
    push,
    deps,
    clock,
    async count(fn) {
      const queries: string[] = [];
      const prev = pool.options.debug;
      pool.options.debug = (c, q) => {
        if (!TX_CTL.test(q)) queries.push(q);
        if (typeof prev === "function") prev(c, q);
      };
      try {
        const r = await fn();
        return { n: queries.length, queries, r };
      } finally {
        pool.options.debug = prev;
      }
    },
    stop: () => db.close(),
  };
}
export { drain };

/** Ghi thông báo của một tenant qua cổng (đúng đường gói) — trả số hàng mới. */
export const send = (tenantId: string, rows: Notice[], key = "pkdemo"): Promise<number> =>
  inPack(key, tenantId, (tx) => enqueue(tx, key, rows));

/** Như `send` nhưng GIỮ một kết nối `hub_api` (đo hàm cổng, không đo mở kết nối). */
export function packSender(
  key: string,
  tenantId: string,
): { send(rows: Notice[]): Promise<number>; close(): Promise<void> } {
  const conn = postgres(HUB_API_URL, { max: 1, onnotice: () => {} });
  return {
    send: (rows) =>
      conn.begin(async (tx) => {
        await tx`select set_config('role', ${`${key}_rw`}, true), set_config('app.tenant_id', ${tenantId}, true)`;
        return enqueue(tx as unknown as Sql, key, rows);
      }) as Promise<number>,
    close: () => conn.end({ timeout: 1 }),
  };
}
