// HUB-NFR-04 · kết nối Postgres của hub-api bằng role `hub_api` (`HUB_DATABASE_URL`, plan §3.4, §7).
import { createDb, type Db } from "@ai/db";
import { sql } from "drizzle-orm";

export type { Db };

export function connectDb(url: string, max = 10): Db {
  return createDb(url, { max });
}

/** `select 1` cho /health và kiểm lúc khởi động. Ném lỗi khi DB không trả lời. */
export async function pingDb(db: Db): Promise<void> {
  await db.db.execute(sql`select 1`);
}
