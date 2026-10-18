// HUB-NFR-04 · kết nối Postgres của hub-api bằng role `hub_api` (`HUB_DATABASE_URL`, plan §3.4, §7).
// CR-093 · T19-perf vòng 3: `spread` = phát câu chuẩn bị mới sang mọi kết nối của pool (`@ai/db` `prepare-spread`) ⇒
// đường nóng (POST Đạt, launch, stage tool) nóng trên cả pool sau lượt đầu, không phải sau ~`max` lượt; lỗi phát chỉ log.
// Chỉ `server.ts` bật: describe đi qua `options.debug` nên test đếm câu (PD2-P03/P04) sẽ đếm cả câu phát ⇒ mặc định tắt.
import { createDb, type Db } from "@ai/db";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "./errors";
import { logger } from "./logger";

export type { Db };

export function connectDb(url: string, max = 10, o: { spread?: boolean } = {}): Db {
  return createDb(url, {
    max,
    spread: o.spread === true,
    onSpreadError: (err) => logger.warn("db-prepare-spread-failed", safeErrorFields(err)),
  });
}

/** `select 1` cho /health và kiểm lúc khởi động. Ném lỗi khi DB không trả lời. */
export async function pingDb(db: Db): Promise<void> {
  await db.db.execute(sql`select 1`);
}
