// one-agent · nhãn ngữ cảnh của dock trợ lý (lớp 3): tên ngắn của HĐ / đối tác người gọi ĐANG XEM. Chạy TRONG tx `PackUow`
// (role `contracts_rw`, RLS FORCE + luật thấy M1 theo `app.user_id` = người gọi) ⇒ HĐ người gọi không mở được = không có hàng.
// Đối tác (khoá `party_key`) chỉ có nhãn khi người gọi thấy ít nhất một HĐ có đối tác đó (bên bán hoặc bên mua). Mỗi lời gọi
// MỘT câu SQL. HĐ: theo khoá chính. Đối tác: quét HĐ của tenant người gọi thấy (dừng ở hàng khớp đầu tiên) — chỉ một lần mỗi
// tin của dock có `?party=`; tenant hiện ≤ vài nghìn HĐ.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type ContractLabelRow = {
  title: string;
  number: string | null;
  end_date: string | null;
};

export function contextLabelRepo(tx: Tx, t: string) {
  return {
    contract: async (id: string): Promise<ContractLabelRow | null> => {
      const rows = await tx.execute<ContractLabelRow>(sql`select c.title, c.number,
          to_char(c.end_date, 'YYYY-MM-DD') as end_date
        from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid`);
      return [...rows][0] ?? null;
    },
    partner: async (party: string): Promise<string | null> => {
      const rows = await tx.execute<{ name: string | null }>(sql`select x.name
        from contracts.contracts c
        cross join lateral (values
          (c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value'),
          (c.fields -> 'buyer_name' ->> 'value', c.fields -> 'buyer_tax_id' ->> 'value')) x (name, tax)
        where c.tenant_id = ${t}::uuid and x.name is not null and contracts.party_key(x.name, x.tax) = ${party}
        limit 1`);
      return [...rows][0]?.name ?? null;
    },
  };
}
