// ADM-NFR-06, ADM-FR-53 · kết nối Postgres (postgres.js + Drizzle, ADR-0003) + `notify` cho `config_changed` (M3).
// ADM-FR-41 · M4: `listen` (LISTEN `quota_threshold`, plan M4 §5.2).
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createSpread, type SpreadPool, type StatementSpread } from "./prepare-spread";

export type Db = {
  db: PostgresJsDatabase;
  /** Số kết nối tối đa của pool (CR-093: làm nóng pool vòng nền mở đúng chừng này kết nối). */
  max: number;
  /** Có khi createDb(…, { spread: true }). */
  spread?: StatementSpread;
  close(): Promise<void>;
  /** `pg_notify` trên một kết nối của pool, NGOÀI mọi transaction (gọi sau commit, TECH-DEBT #13). */
  notify(channel: string, payload: string): Promise<void>;
  /**
   * LISTEN trên kết nối riêng do postgres.js giữ (tự nối lại); `onPayload` nhận chuỗi thô, người gọi tự parse/validate.
   * Trả hàm huỷ đăng ký.
   */
  listen(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>>;
};

type Unsafe = (q: string, args?: unknown[], o?: Record<string, unknown>) => unknown;
type Scoped = (...a: unknown[]) => unknown;

/**
 * CR-093 Luật 4c · T19-perf · Drizzle gọi `client.unsafe(text, params)` mà postgres.js mặc định `prepare: false` cho
 * `unsafe` ⇒ MỖI câu có tham số đi 2 round-trip (Parse/Describe chờ kiểu rồi mới Bind/Execute), lập kế hoạch lại mỗi lần
 * và chặn pipeline (`describeFirst`). Bọc client (cả `begin`/`savepoint` lồng nhau) để `unsafe` dùng câu chuẩn bị có tên:
 * mỗi kết nối chuẩn bị một lần theo văn bản + kiểu (postgres.js tự lưu, tự thử lại khi kế hoạch cũ đổi kiểu kết quả), sau
 * đó 1 round-trip/câu và câu độc lập gửi liền được. Câu không tham số vẫn đi giao thức simple như cũ. Không đổi văn bản
 * SQL ⇒ đếm câu (debug) không đổi. `$client.options` vẫn là của pool gốc (hook debug của test đếm câu).
 */
export function preparing<T extends object>(s: T, spread?: StatementSpread): T {
  return new Proxy(s, {
    get(t, k) {
      const v = Reflect.get(t, k) as unknown;
      if (k === "unsafe")
        return (q: string, args?: unknown[], o?: Record<string, unknown>) => {
          if (spread && args && o?.prepare !== false) spread.see(q, args);
          return (v as Unsafe).call(t, q, args, { prepare: true, ...o });
        };
      if (k === "begin" || k === "savepoint")
        return (...a: unknown[]) => {
          const fn = a.pop() as (tx: object) => unknown;
          return (v as Scoped).call(t, ...a, (tx: object) => fn(preparing(tx, spread)));
        };
      return v;
    },
  });
}

export type CreateDbOpts = {
  max?: number;
  /** T19-perf vòng 3 · phát câu chuẩn bị mới sang mọi kết nối (prepare-spread.ts); lỗi phát gọi onSpreadError. */
  spread?: boolean;
  onSpreadError?: (err: unknown) => void;
};

export function createDb(url: string, opts: CreateDbOpts = {}): Db {
  const max = opts.max ?? 10;
  const sql = postgres(url, { max, onnotice: () => {} });
  const spread = opts.spread
    ? createSpread(sql as unknown as SpreadPool, max, opts.onSpreadError ?? (() => {}))
    : undefined;
  return {
    db: drizzle(preparing(sql, spread)),
    spread,
    max,
    close: async () => {
      await spread?.idle();
      await sql.end();
    },
    notify: async (channel, payload) => {
      await sql.notify(channel, payload);
    },
    listen: async (channel, onPayload) => {
      const sub = await sql.listen(channel, onPayload);
      return () => sub.unlisten();
    },
  };
}
