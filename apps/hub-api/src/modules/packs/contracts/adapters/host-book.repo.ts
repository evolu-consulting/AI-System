// com-c8-host-read · cổng đọc sổ chủ quản — SQL. Tx do `PackUow` mở (RLS tenant + luật thấy M1); lọc `tenant_id` tường minh. Luật 4c:
// ĐÚNG 2 câu văn bản cố định mỗi lần gọi (dữ liệu lô qua một tham số JSON), không theo số gợi ý/SP.
//   1. ứng viên tên: theo id, hoặc `name_key` = khoá | tiền tố khoá (mỗi gợi ý ≤ 5, lateral theo index (tenant_id, name_key));
//   2. kho + giá vốn BQ của THÀNH PHẦN CHÍNH (như tab NCC & giá) + giá đã ghi nhận mới nhất (≤ 10/SP) — chỉ cột sẵn có.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { HostBookRepo, HostPriceOut } from "../application/host-book.ports";
import { type HostHint, hintKey } from "../domain/host-book.rules";

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const PRICES_PER_PRODUCT = 10;

export function hostBookRepo(tx: Tx, t: string): HostBookRepo {
  const candidates: HostBookRepo["candidates"] = async (hints: readonly HostHint[]) => {
    const out = new Map<
      number,
      { id: string; name: string; nameKey: string; unit: string | null }[]
    >();
    if (hints.length === 0) return out;
    const hs = hints.map((h, i) => ({
      i,
      id: h.productId ?? null,
      key: h.productId ? null : hintKey(h),
      like: h.productId ? null : `${likeEsc(hintKey(h))}%`,
    }));
    const rows = await tx.execute<{
      i: number;
      id: string;
      name: string;
      name_key: string;
      unit: string | null;
    }>(sql`select h.i, p.id::text, p.name, p.name_key, p.unit
      from jsonb_to_recordset(${JSON.stringify(hs)}::jsonb) as h(i int, id uuid, key text, "like" text)
      cross join lateral (
        select p0.id, p0.name, p0.name_key, p0.unit from contracts.products p0
        where p0.tenant_id = ${t}::uuid
          and ((h.id is not null and p0.id = h.id)
            or (h.id is null and h.key <> '' and (p0.name_key = h.key or p0.name_key like h."like")))
        order by (p0.name_key = h.key) desc, length(p0.name_key), p0.name_key limit 5) p`);
    for (const r of rows) {
      const l = out.get(r.i) ?? [];
      l.push({ id: r.id, name: r.name, nameKey: r.name_key, unit: r.unit });
      out.set(r.i, l);
    }
    return out;
  };

  const book: HostBookRepo["book"] = async (productIds) => {
    const out = new Map<
      string,
      { onHand: string | null; avgCost: number | null; prices: HostPriceOut[] }
    >();
    // Không có SP khớp vẫn chạy câu thứ hai (mảng rỗng) ⇒ luôn đúng 2 câu mỗi lần gọi.
    const rows = await tx.execute<{
      id: string;
      on_hand: string | null;
      avg_cost: string | null;
      prices: {
        supplier_name: string;
        supplier_party_key: string | null;
        price: number;
        unit: string | null;
        source: string;
        seen_on: string;
      }[];
    }>(sql`select p.id::text, c.on_hand::text as on_hand, c.avg_cost::text as avg_cost,
        coalesce((select jsonb_agg(jsonb_build_object('supplier_name', s.supplier_name,
            'supplier_party_key', s.supplier_party_key, 'price', s.price, 'unit', s.unit, 'source', s.source,
            'seen_on', s.seen_on) order by s.seen_on desc, s.created_at desc)
          from (select * from contracts.product_supplier_prices s0
            where s0.tenant_id = p.tenant_id and s0.product_id = p.id
            order by s0.seen_on desc, s0.created_at desc limit ${PRICES_PER_PRODUCT}) s), '[]'::jsonb) as prices
      from contracts.products p
        left join lateral (select c2.on_hand, c2.avg_cost from contracts.product_components c2
          where c2.tenant_id = p.tenant_id and c2.product_id = p.id and c2.mode <> 'none'
          order by c2.ord limit 1) c on true
      where p.tenant_id = ${t}::uuid and p.id = any(${`{${productIds.join(",")}}`}::uuid[])`);
    for (const r of rows) {
      out.set(r.id, {
        onHand: r.on_hand,
        avgCost: r.avg_cost === null ? null : Number(r.avg_cost),
        prices: r.prices.map((x) => ({
          supplierName: x.supplier_name,
          supplierPartyKey: x.supplier_party_key,
          price: Number(x.price),
          unit: x.unit,
          source: x.source,
          seenOn: x.seen_on,
        })),
      });
    }
    return out;
  };

  return { candidates, book };
}
