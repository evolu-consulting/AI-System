// HUB-FR-44 · CR-filebox · `BlobIndex` trên bảng `hub.attachment_blobs` (migration hub 0019): mỗi thao tác một transaction
// scope `system` (RLS chỉ cho `system`). Gọi được cả khi đang trong transaction khác (sweeper) — connection riêng của pool.
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import type { StoreCursor } from "./storage";
import type { BlobIndex, BlobRow } from "./storage.filebox";

type Row = {
  storage_key: string;
  file_id: string | null;
  partial: boolean;
  size: string;
  created_ms: string;
};

const toBlob = (r: Row): BlobRow => ({
  key: r.storage_key,
  fileId: r.file_id,
  partial: r.partial,
  size: Number(r.size),
  createdMs: Number(r.created_ms),
});

const COLS = sql`storage_key, file_id, partial, size::text AS size,
  (extract(epoch FROM created_at) * 1000)::bigint::text AS created_ms`;

export function sqlBlobIndex(db: Db): BlobIndex {
  const sys = <T>(fn: (tx: Tx) => Promise<T>) => withHubScope(db, { kind: "system" }, fn);
  return {
    reserve: (key) =>
      sys(async (tx) => {
        const r =
          await tx.execute(sql`INSERT INTO hub.attachment_blobs (storage_key) VALUES (${key})
          ON CONFLICT (storage_key) DO NOTHING RETURNING storage_key`);
        return r.length === 1;
      }),
    attach: (key, fileId, size) =>
      sys(async (tx) => {
        await tx.execute(sql`UPDATE hub.attachment_blobs SET file_id = ${fileId}, size = ${size}
          WHERE storage_key = ${key}`);
      }),
    commit: (key) =>
      sys(async (tx) => {
        await tx.execute(
          sql`UPDATE hub.attachment_blobs SET partial = false WHERE storage_key = ${key}`,
        );
      }),
    get: (key) =>
      sys(async (tx) => {
        const [r] = await tx.execute<Row>(
          sql`SELECT ${COLS} FROM hub.attachment_blobs WHERE storage_key = ${key}`,
        );
        return r ? toBlob(r) : null;
      }),
    drop: (key) =>
      sys(async (tx) => {
        await tx.execute(sql`DELETE FROM hub.attachment_blobs WHERE storage_key = ${key}`);
      }),
    list: (after: StoreCursor | null, limit: number) =>
      sys(async (tx) => {
        const where = after
          ? sql`WHERE storage_key > ${after.key}
              OR (storage_key = ${after.key} AND partial AND NOT ${after.partial}::boolean)`
          : sql``;
        const rows = await tx.execute<Row>(sql`SELECT ${COLS} FROM hub.attachment_blobs ${where}
          ORDER BY storage_key, partial LIMIT ${limit}`);
        return rows.map(toBlob);
      }),
  };
}
