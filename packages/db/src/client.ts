// ADM-NFR-06 · kết nối Postgres (postgres.js + Drizzle, ADR-0003).
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type Db = { db: PostgresJsDatabase; close(): Promise<void> };

export function createDb(url: string, opts: { max?: number } = {}): Db {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return { db: drizzle(sql), close: () => sql.end() };
}
