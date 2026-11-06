// CR-121 c9 · SQL "Sao chép cho công ty này" + đọc chỉ-xem theo công ty. Chạy trong tx scope system (sau cổng vai ở service), lọc
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
};

export async function readGlobalDef(tx: Tx, id: string): Promise<GlobalDef | null> {
  const [r] = await tx.execute<GlobalDef>(sql`select d.id::text as id, d.key, d.description, d.slot,
      d.published_version, (d.deleted_at is not null) as deleted
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

/** Khoá bản riêng còn trống đầu tiên của công ty: `<base>`, `<base>-2`, … (một câu lấy mọi khoá cùng tiền tố). */
export async function freeCompanyKey(tx: Tx, tenantId: string, base: string): Promise<string> {
  const rows = await tx.execute<{ key: string }>(sql`select key from hub.process_defs
    where tenant_id = ${tenantId} and deleted_at is null and starts_with(key, ${base})`);
  const taken = new Set(rows.map((r) => r.key));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  throw new Error("freeCompanyKey: hết hậu tố");
}

/** Bản riêng từ BẢN XUẤT BẢN (`stages`/`slot_body`/`name` của release), tắt (`enabled=false`), không khe (CHECK `process_defs_slot_ck`). */
export async function insertCompanyCopy(
  tx: Tx,
  w: {
    src: string;
    tenantId: string;
    key: string;
    name: string;
    stages: unknown[];
    slotBody: unknown;
    relVersion: number;
    actorId: string;
  },
): Promise<string> {
  const [r] = await tx.execute<{
    id: string;
  }>(sql`insert into hub.process_defs (tenant_id, key, name, description,
      input_hint, stages, token_budget, enabled, sources, inputs, ttl_days, source_template_id, source_rel_version,
      slot_body, created_by, updated_by)
    select ${w.tenantId}, ${w.key}, ${w.name}, description, input_hint, ${JSON.stringify(w.stages)}::jsonb, token_budget,
      false, '[]'::jsonb, inputs, ttl_days, id, ${w.relVersion}, ${JSON.stringify(w.slotBody ?? null)}::jsonb,
      ${w.actorId}, ${w.actorId}
    from hub.process_defs where id = ${w.src} and tenant_id is null returning id::text as id`);
  if (!r) throw new Error("cloneForCompany: không ghi được bản riêng");
  return r.id;
}

/** Mặc định của khe (mẫu cấp phát) — null = khe chưa có mặc định. */
export async function slotDefaultOf(tx: Tx, slot: string): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(
    sql`select default_def_id::text as id from hub.process_slots where slot = ${slot}`,
  );
  return r?.id ?? null;
}

/**
 * Đổi MỌI luật (mặc định + điều kiện) của công ty × khe đang trỏ ĐÚNG `from` sang `to` — một câu; luật mặc định thành nguồn
 * `admin` (người chủ động đổi). Luật trỏ def khác giữ nguyên. `to` PHẢI đã có trong `process_tenant_defs` (FK). Trả số luật đổi.
 */
export async function repointRules(
  tx: Tx,
  w: { tenantId: string; slot: string; from: string; to: string },
): Promise<number> {
  const rows = await tx.execute(sql`update hub.process_routing_rules
    set def_id = ${w.to}, source = case when is_default then 'admin' else source end
    where tenant_id = ${w.tenantId} and slot = ${w.slot} and def_id = ${w.from}`);
  return rows.count;
}

/** Đầu luật `version` + 1 (màn luật đang mở nhận 409). */
export async function bumpRoutingHead(
  tx: Tx,
  w: { tenantId: string; slot: string; actorId: string },
): Promise<void> {
  await tx.execute(sql`update hub.process_routings set version = version + 1, updated_by = ${w.actorId}, updated_at = now()
    where tenant_id = ${w.tenantId} and slot = ${w.slot}`);
}
