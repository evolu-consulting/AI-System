// HD-FR-07 · HD-AC03 · HD-AC04 · HD-AC05 · HD-BR-03 · D-03 · D-18 · HD1 plan §6: danh sách hợp đồng của tenant token —
// lọc/sắp/phân trang `page/page_size/total` trong MỘT câu SQL (tx RLS `PackUow`). `signer` ⇒ khoá người, `q` ⇒ mẫu LIKE đã fold.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { likePattern, personKey } from "../domain/fold.rules";
import type {
  ContractListFilter,
  ContractListInput,
  ContractListPage,
  ContractsReadRepo,
} from "./ports";

export type ContractListResult<Row> = ContractListPage<Row> & { page: number; page_size: number };
export type ListContracts<Row> = (
  who: PackWho,
  q: ContractListInput,
) => Promise<ContractListResult<Row>>;

const arr = (xs: readonly string[] | undefined): readonly string[] | null =>
  xs && xs.length > 0 ? xs : null;

/** Thuần: đầu vào đã kiểm ⇒ bộ lọc SQL (`null` = không lọc). Signer chỉ có chức danh ⇒ `[]` (không khớp gì). */
export function toListFilter(q: ContractListInput): ContractListFilter {
  const signer = arr(q.signer);
  return {
    status: arr(q.status),
    owner: arr(q.owner),
    category: arr(q.category),
    seller: arr(q.seller),
    buyer: arr(q.buyer),
    signerKeys: signer
      ? [...new Set(signer.map(personKey).filter((k): k is string => k !== null))]
      : null,
    direction: arr(q.direction),
    kind: arr(q.kind),
    valueMin: q.value_min ?? null,
    valueMax: q.value_max ?? null,
    like: q.q ? `%${likePattern(q.q)}%` : null,
    order: `${q.sort}:${q.dir}`,
    limit: q.page_size,
    offset: (q.page - 1) * q.page_size,
  };
}

export function listContracts<Row>(d: {
  uow: PackUow<{ contracts: Pick<ContractsReadRepo<Row, unknown>, "list"> }>;
}): ListContracts<Row> {
  return async (who, q) => {
    const f = toListFilter(q);
    const p = await d.uow.tenant(who, (r) => r.contracts.list(f));
    return { items: p.items, total: p.total, page: q.page, page_size: q.page_size };
  };
}
