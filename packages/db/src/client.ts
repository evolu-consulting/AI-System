// ADM-NFR-06, ADM-FR-53 · kết nối Postgres (postgres.js + Drizzle, ADR-0003) + `notify` cho `config_changed` (M3).
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type Db = {
  db: PostgresJsDatabase;
  close(): Promise<void>;
  /** `pg_notify` trên một kết nối của pool, NGOÀI mọi transaction (gọi sau commit, TECH-DEBT #13). */
  notify(channel: string, payload: string): Promise<void>;
};

export function createDb(url: string, opts: { max?: number } = {}): Db {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return {
    db: drizzle(sql),
    close: () => sql.end(),
    notify: async (channel, payload) => {
      await sql.notify(channel, payload);
    },
  };
}
