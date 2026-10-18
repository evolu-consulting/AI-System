// ADM-NFR-06, ADM-FR-53 Â· káº¿t ná»‘i Postgres (postgres.js + Drizzle, ADR-0003) + `notify` cho `config_changed` (M3).
// ADM-FR-41 Â· M4: `listen` (LISTEN `quota_threshold`, plan M4 Â§5.2).
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createSpread, type SpreadPool, type StatementSpread } from "./prepare-spread";

export type Db = {
  db: PostgresJsDatabase;
  /** Sá»‘ káº¿t ná»‘i tá»‘i Ä‘a cá»§a pool (CR-093: lÃ m nÃ³ng pool vÃ²ng ná»n má»Ÿ Ä‘Ãºng chá»«ng nÃ y káº¿t ná»‘i). */
  max: number;
  /** CÃ³ khi createDb(â€¦, { spread: true }). */
  spread?: StatementSpread;
  close(): Promise<void>;
  /** `pg_notify` trÃªn má»™t káº¿t ná»‘i cá»§a pool, NGOÃ€I má»i transaction (gá»i sau commit, TECH-DEBT #13). */
  notify(channel: string, payload: string): Promise<void>;
  /**
   * LISTEN trÃªn káº¿t ná»‘i riÃªng do postgres.js giá»¯ (tá»± ná»‘i láº¡i); `onPayload` nháº­n chuá»—i thÃ´, ngÆ°á»i gá»i tá»± parse/validate.
   * Tráº£ hÃ m huá»· Ä‘Äƒng kÃ½.
   */
  listen(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>>;
};

type Unsafe = (q: string, args?: unknown[], o?: Record<string, unknown>) => unknown;
type Scoped = (...a: unknown[]) => unknown;

/**
 * CR-093 Luáº­t 4c Â· T19-perf Â· Drizzle gá»i `client.unsafe(text, params)` mÃ  postgres.js máº·c Ä‘á»‹nh `prepare: false` cho
 * `unsafe` â‡’ Má»–I cÃ¢u cÃ³ tham sá»‘ Ä‘i 2 round-trip (Parse/Describe chá» kiá»ƒu rá»“i má»›i Bind/Execute), láº­p káº¿ hoáº¡ch láº¡i má»—i láº§n
 * vÃ  cháº·n pipeline (`describeFirst`). Bá»c client (cáº£ `begin`/`savepoint` lá»“ng nhau) Ä‘á»ƒ `unsafe` dÃ¹ng cÃ¢u chuáº©n bá»‹ cÃ³ tÃªn:
 * má»—i káº¿t ná»‘i chuáº©n bá»‹ má»™t láº§n theo vÄƒn báº£n + kiá»ƒu (postgres.js tá»± lÆ°u, tá»± thá»­ láº¡i khi káº¿ hoáº¡ch cÅ© Ä‘á»•i kiá»ƒu káº¿t quáº£), sau
 * Ä‘Ã³ 1 round-trip/cÃ¢u vÃ  cÃ¢u Ä‘á»™c láº­p gá»­i liá»n Ä‘Æ°á»£c. CÃ¢u khÃ´ng tham sá»‘ váº«n Ä‘i giao thá»©c simple nhÆ° cÅ©. KhÃ´ng Ä‘á»•i vÄƒn báº£n
 * SQL â‡’ Ä‘áº¿m cÃ¢u (debug) khÃ´ng Ä‘á»•i. `$client.options` váº«n lÃ  cá»§a pool gá»‘c (hook debug cá»§a test Ä‘áº¿m cÃ¢u).
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
  /** T19-perf vÃ²ng 3 Â· phÃ¡t cÃ¢u chuáº©n bá»‹ má»›i sang má»i káº¿t ná»‘i (prepare-spread.ts); lá»—i phÃ¡t gá»i onSpreadError. */
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
