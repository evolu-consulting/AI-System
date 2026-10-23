// HD-FR-54 · HD-FR-55 · HD5 plan (Luật 4c): repo phụ lục trong tx `PackUow` (role `contracts_rw`, RLS FORCE). Mọi câu SQL là văn bản
// CỐ ĐỊNH, lọc `tenant_id` tường minh ngoài RLS; số câu mỗi ca không phụ thuộc số hàng (gắn: khoá + CTE; gợi ý: 2; giá: 1).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { AppendixRepo, LockedForParent, ParentSaved } from "../application/appendix.usecase";
import type { PriceItem, PriceSource } from "../domain/appendix-pricing.rules";

const iso = (v: string | Date): string => new Date(v).toISOString();
const json = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
type Kind = "contract" | "appendix";

/** Phụ lục chỉ áp giá khi đã qua kiểm/duyệt (không tính đang đọc/lỗi/chờ kiểm/bị từ chối — như `project.py` chỉ chiếu HĐ đã xác nhận). */
export const PRICED_STATUSES = ["active", "expiring", "expired", "renewed", "terminated"] as const;
const FAMILY_MAX = 101;
const ITEMS_MAX = 500;

function lockQ(tx: Tx, tenantId: string): AppendixRepo["lockForParent"] {
  return async (id, parentId): Promise<LockedForParent | null> => {
    // Khoá cả hai hàng THEO THỨ TỰ id (một câu) rồi mới đọc loại/phụ lục con ở câu sau (ảnh chụp mới): A→B ∥ B→A hay C→A ∥ A→B
    // tuần tự hoá, bên sau thấy hàng đã đổi ⇒ không vòng, không phụ lục của phụ lục.
    await tx.execute(sql`select c.id from contracts.contracts c
        where c.tenant_id = ${tenantId}::uuid and c.id = any(array[${id}::uuid, ${parentId}::uuid]) order by c.id for update`);
    const rows = await tx.execute<{
      version: number;
      kind: Kind;
      parent_id: string | null;
      updated_at: string | Date;
      has_appendices: boolean;
      parent_kind: Kind | null;
      locked: boolean;
    }>(sql`select c.version, c.kind, c.parent_id, c.updated_at, c.locked_at is not null as locked,
          exists (select 1 from contracts.contracts a where a.parent_id = c.id and a.tenant_id = c.tenant_id) as has_appendices,
          (select p.kind from contracts.contracts p where p.id = ${parentId}::uuid and p.tenant_id = c.tenant_id) as parent_kind
        from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid for update of c`);
    const r = rows[0];
    return r
      ? {
          version: r.version,
          kind: r.kind,
          parentId: r.parent_id,
          updatedAt: iso(r.updated_at),
          hasAppendices: r.has_appendices,
          parentKind: r.parent_kind,
          locked: r.locked,
        }
      : null;
  };
}

function setParentQ(tx: Tx, tenantId: string): AppendixRepo["setParent"] {
  return async (id, s): Promise<ParentSaved> => {
    const rows = await tx.execute<{
      version: number;
      updated_at: string | Date;
      kind: Kind;
      parent_id: string | null;
    }>(sql`with u as (
          update contracts.contracts set parent_id = ${s.parentId}::uuid,
            kind = case when ${s.parentId}::uuid is null then 'contract' else 'appendix' end,
            version = version + 1, updated_at = now()
          where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and version = ${s.expected}::int
          returning id, version, updated_at, kind, parent_id),
        e as (
          insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tenantId}::uuid, u.id, 'parent_changed', ${s.actor}::uuid,
            jsonb_build_object('from', ${s.from}::text, 'to', ${s.parentId}::text) from u)
        select u.version, u.updated_at, u.kind, u.parent_id from u`);
    const r = rows[0];
    if (!r) throw new Error("attach-parent: row vanished under lock");
    return {
      version: r.version,
      updatedAt: iso(r.updated_at),
      kind: r.kind,
      parentId: r.parent_id,
    };
  };
}

export function appendixRepo(tx: Tx, tenantId: string): AppendixRepo {
  return {
    lockForParent: lockQ(tx, tenantId),
    setParent: setParentQ(tx, tenantId),
    hints: async (id) => {
      const rows = await tx.execute<{
        kind: Kind;
        seller: string | null;
        buyer: string | null;
        head: string | null;
      }>(sql`select c.kind, c.seller, c.buyer, left(c.source_text, 4000) as head
        from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid`);
      const r = rows[0];
      return r
        ? { kind: r.kind, seller: r.seller, buyer: r.buyer, head: r.head, cited: null }
        : null;
    },
    candidates: async (id, limit) =>
      tx.execute<{
        id: string;
        title: string;
        number: string | null;
        seller: string | null;
        buyer: string | null;
      }>(sql`select c.id, c.title, c.number, c.seller, c.buyer from contracts.contracts c
        where c.tenant_id = ${tenantId}::uuid and c.kind = 'contract' and c.id <> ${id}::uuid
        order by c.updated_at desc, c.id desc limit ${limit}::int`),
    family: familyQ(tx, tenantId),
  };
}

function familyQ(tx: Tx, tenantId: string): AppendixRepo["family"] {
  return async (id): Promise<PriceSource[] | null> => {
    const rows = await tx.execute<{ fam: PriceSourceRaw[] | string | null }>(sql`with r as (
          select coalesce(c.parent_id, c.id) as root from contracts.contracts c
          where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid),
        fam as (
          select c.id, c.kind, c.title, c.created_at,
            contracts.as_date(c.fields -> 'effective_date' ->> 'value') as eff
          from contracts.contracts c
          where c.tenant_id = ${tenantId}::uuid
            and (c.id = (select root from r) or c.parent_id = (select root from r))
            and (c.kind = 'contract' or c.status in ('active', 'expiring', 'expired', 'renewed', 'terminated'))
          order by (c.kind = 'appendix'), c.created_at, c.id limit ${FAMILY_MAX}::int)
        select json_agg(json_build_object('id', f.id, 'kind', f.kind, 'title', f.title, 'effective_date', f.eff,
          'items', coalesce((select json_agg(json_build_object('code', i.code, 'name', i.name, 'spec', i.spec,
              'unit', i.unit, 'qty', i.qty, 'unit_price', i.unit_price, 'vat_rate', i.vat_rate,
              'valid_from', i.valid_from, 'valid_to', i.valid_to) order by i.ord)
            from (select i.* from contracts.contract_items i
              where i.contract_id = f.id and i.tenant_id = ${tenantId}::uuid order by i.ord limit ${ITEMS_MAX}::int) i),
            '[]'::json))
          order by (f.kind = 'appendix'), f.created_at, f.id) as fam
        from fam f`);
    const fam = rows[0]?.fam;
    if (!fam) return null;
    return json(fam).map((f) => ({
      id: f.id,
      kind: f.kind,
      title: f.title,
      effective_date: f.effective_date,
      items: f.items,
    }));
  };
}

type PriceSourceRaw = {
  id: string;
  kind: Kind;
  title: string;
  effective_date: string | null;
  items: PriceItem[];
};
