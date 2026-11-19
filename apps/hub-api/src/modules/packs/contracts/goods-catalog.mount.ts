// CR-191 BR-191-6 · cổng đọc «Sản phẩm & Giá» của công ty cho gợi ý hàng hoá ở ô soạn bài Community (tiêm vào `GoodsCatalog` của community).
// Quyền: người gọi phải có việc `read` của gói contracts (như `hostBookModule`); người dùng ngoài ⇒ rỗng. MỘT câu SQL cố định theo tenant của
// người gọi (tìm theo tên đã bỏ dấu, ≤ limit) + đơn giá = giá GẦN NHẤT trong «Sản phẩm & Giá» (`product_supplier_prices`, theo ngày thấy).
import type { GoodsSuggestion } from "@ai/contracts/community";
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import {
  createPackUow,
  type PackAccessView,
  type PackWho,
  packAccessInput,
  packActionsFor,
} from "../kit/public";
import { likePattern } from "./domain/fold.rules";

const KEY = "contracts";

export async function catalogGoods(
  tx: Tx,
  tenantId: string,
  q: string,
  limit: number,
): Promise<GoodsSuggestion[]> {
  const pat = q ? likePattern(q) : null;
  const rows = await tx.execute<{ name: string; unit: string | null; price: string | null }>(sql`
    select p.name, coalesce(p.unit, lp.unit) as unit,
      case when lp.price is null then null else replace(to_char(lp.price, 'FM999,999,999,999,999'), ',', '.') end as price
    from contracts.products p
    left join lateral (select s.price, s.unit from contracts.product_supplier_prices s
        where s.tenant_id = p.tenant_id and s.product_id = p.id order by s.seen_on desc, s.created_at desc limit 1) lp on true
    where p.tenant_id = ${tenantId}::uuid
      and (${pat}::text is null or p.name_key like '%' || ${pat}::text || '%')
    order by p.name_key limit ${limit}::int`);
  return rows.map((r) => ({
    name: r.name,
    ...(r.unit?.trim() ? { unit: r.unit.trim() } : {}),
    ...(r.price ? { price: r.price } : {}),
    source: "catalog" as const,
  }));
}

export function goodsCatalogModule(
  db: Db,
  view: PackAccessView,
): (who: PackWho, q: string, limit: number) => Promise<readonly GoodsSuggestion[]> {
  const uow = createPackUow(db, KEY, (tx) => ({ tx }));
  return async (who, q, limit) => {
    if (who.userKind === "external") return [];
    if (!packActionsFor(await packAccessInput(view, KEY, who)).includes("read")) return [];
    return uow.tenant(who, ({ tx }) => catalogGoods(tx, who.tenantId, q, limit));
  };
}
