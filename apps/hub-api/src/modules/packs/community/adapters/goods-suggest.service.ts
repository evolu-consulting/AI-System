// CR-191 BR-191-6 · gợi ý hàng hoá cho Cần bán/Cần mua: MỘT câu «hàng công ty đã đăng» (bài chủ quản của tenant, RLS áp, khử trùng theo tên)
// + cổng tuỳ chọn `catalog` (Sản phẩm & Giá của công ty, tiêm lúc mount; vắng ⇒ chỉ nguồn «đã đăng»). Số câu cố định (≤ 2), ≤ 8 dòng.
// Đơn vị lấy từ số lượng đã đăng («100 cuộn» ⇒ «cuộn»); đơn giá chỉ gợi ý khi bài là Cần bán có giá.
import type { GoodsSuggestion } from "@ai/contracts/community";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PackUow } from "../../kit/public";
import type { Access } from "./community-access";

export const GOODS_MAX = 8;
export type GoodsCatalog = (
  who: Access["who"],
  q: string,
  limit: number,
) => Promise<readonly GoodsSuggestion[]>;

export const unitOf = (qty: string | null | undefined): string => {
  const m = /^\s*[\d.,]+(?![\d.,])\s*(.+)$/u.exec(qty ?? "");
  return (m?.[1] ?? "").trim().slice(0, 40);
};

export async function postedGoods(tx: Tx, q: string, limit: number): Promise<GoodsSuggestion[]> {
  const like = `%${q.replace(/[%_]/g, "$&")}%`;
  const rows = await tx.execute<{ name: string; qty: string | null; price: string | null }>(sql`
    select distinct on (lower(p.fields_raw ->> 'product'))
      p.fields_raw ->> 'product' as name, p.fields_raw ->> 'qty' as qty,
      case when p.type = 'sell' then p.fields_raw ->> 'price' end as price
    from community.posts p
    where p.author_org is null and p.type in ('sell', 'buy') and coalesce(p.fields_raw ->> 'product', '') <> ''
      and (${q} = '' or p.fields_raw ->> 'product' ilike ${like})
    order by lower(p.fields_raw ->> 'product'), p.created_at desc
    limit ${limit}::int`);
  return rows.map((r) => ({
    name: r.name,
    ...(unitOf(r.qty) ? { unit: unitOf(r.qty) } : {}),
    ...(r.price?.trim() ? { price: r.price.trim() } : {}),
    source: "posted" as const,
  }));
}

/** Gợi ý ≤ 8: Sản phẩm & Giá trước, rồi hàng đã đăng; khử trùng theo tên (không phân biệt hoa/thường). Người ngoài (đối tác) ⇒ rỗng. */
export async function suggestGoods(
  uow: PackUow<{ tx: Tx }>,
  a: Access,
  catalog: GoodsCatalog | undefined,
  q: string,
): Promise<GoodsSuggestion[]> {
  if (a.org !== null) return [];
  const term = q.trim();
  const posted = await uow.tenant(a.who, ({ tx }) => postedGoods(tx, term, GOODS_MAX));
  const cat = catalog ? await catalog(a.who, term, GOODS_MAX).catch(() => []) : [];
  const seen = new Set<string>();
  return [...cat, ...posted]
    .filter((g) => {
      const k = g.name.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, GOODS_MAX);
}
