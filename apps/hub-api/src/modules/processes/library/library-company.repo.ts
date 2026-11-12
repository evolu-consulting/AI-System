// CR-121 c9 · SQL đọc chỉ-xem theo công ty (CR-127 Z5: đã gỡ phần sao chép). Chạy trong tx scope system (sau cổng vai ở service), lọc
// tenant TƯỜNG MINH. Mỗi hàm MỘT câu cố định (Luật 4c): không câu theo hàng.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

/** Hàng `process_defs` toàn cục (`tenant_id NULL`): def thư viện (có khe) hoặc mẫu (không khe). */
export type GlobalDef = {
  id: string;
  key: string;
  description: string;
  slot: string | null;
  published_version: number | null;
  deleted: boolean;
  /** CR-122 · flow Thư viện theo sự kiện (không khe). */
  trigger: unknown;
  app: string | null;
};

export async function readGlobalDef(tx: Tx, id: string): Promise<GlobalDef | null> {
  const [r] = await tx.execute<GlobalDef>(sql`select d.id::text as id, d.key, d.description, d.slot,
      d.published_version, (d.deleted_at is not null) as deleted, d.trigger, d.app
    from hub.process_defs d where d.id = ${id} and d.tenant_id is null`);
  return r ?? null;
}

export type CompanyCopy = { id: string; source_rel_version: number };

/** Bản riêng còn sống của công ty đã sao từ `src` (cũ nhất) — null = chưa sao. Index `process_defs_company_copy_idx`. */
export async function companyCopyOf(
  tx: Tx,
  tenantId: string,
  src: string,
): Promise<CompanyCopy | null> {
  const [r] = await tx.execute<CompanyCopy>(sql`select d.id::text as id, d.source_rel_version
    from hub.process_defs d where d.tenant_id = ${tenantId} and d.source_template_id = ${src}
      and d.source_rel_version is not null and d.deleted_at is null order by d.created_at, d.id limit 1`);
  return r ? { id: r.id, source_rel_version: Number(r.source_rel_version) } : null;
}
