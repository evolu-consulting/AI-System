// CR-152 · điều kiện SQL «HĐ có tính tiền không»: Thỏa thuận hợp tác «không chia tiền» (`kind_terms.split_basis = 'none'`) loại khỏi doanh thu,
// business, điểm đối tác như HĐ nguyên tắc (`doc_type <> 'framework'`). Cùng luật thuần `countsMoney` ở `domain/kind-terms.rules.ts`.
import { sql } from "drizzle-orm";

export const countsMoneySql = (alias: string) =>
  sql.raw(
    `(${alias}.deal is distinct from 'cooperation' or ${alias}.kind_terms ->> 'split_basis' is distinct from 'none')`,
  );
