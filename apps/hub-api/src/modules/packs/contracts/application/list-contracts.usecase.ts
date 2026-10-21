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

/** `YYYY-MM-DD` + n ngày (lịch UTC thuần, không phụ thuộc múi giờ tiến trình). */
export function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Gap #10: cửa sổ ngày của bộ lọc (`due` thắng khoảng). `today` = ngày lịch tenant; `due` mà không có `today` ⇒ ngày UTC. */
export function dateWindow(
  q: Pick<ContractListInput, "due" | "date_from" | "date_to">,
  today: string,
): { from: string | null; to: string | null } {
  if (q.due === "overdue") return { from: null, to: addDays(today, -1) };
  if (q.due) return { from: today, to: addDays(today, Number(q.due)) };
  return { from: q.date_from ?? null, to: q.date_to ?? null };
}

/** Thuần: đầu vào đã kiểm ⇒ bộ lọc SQL (`null` = không lọc). Signer chỉ có chức danh ⇒ `[]` (không khớp gì). */
export function toListFilter(q: ContractListInput, today?: string): ContractListFilter {
  const win = dateWindow(q, today ?? new Date().toISOString().slice(0, 10));
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
    dateField: q.date_field ?? "end_date",
    dateFrom: win.from,
    dateTo: win.to,
    like: q.q ? `%${likePattern(q.q)}%` : null,
    order: `${q.sort}:${q.dir}`,
    limit: q.page_size,
    offset: (q.page - 1) * q.page_size,
  };
}

export function listContracts<Row>(d: {
  uow: PackUow<{ contracts: Pick<ContractsReadRepo<Row, unknown>, "list"> }>;
  /** V2-A: ngày lịch tenant (giai đoạn/quá hạn); vắng ⇒ ngày UTC. */
  today?: (tenantId: string) => Promise<string>;
}): ListContracts<Row> {
  return async (who, q) => {
    const want = q.include === "progress";
    const today =
      want || q.due
        ? await (d.today?.(who.tenantId) ?? new Date().toISOString().slice(0, 10))
        : undefined;
    const f = toListFilter(q, today);
    const p = await d.uow.tenant(who, (r) => r.contracts.list(f, want ? today : undefined));
    return {
      items: p.items,
      total: p.total,
      parents: p.parents,
      ...(want ? { progress: p.progress ?? [] } : {}),
      page: q.page,
      page_size: q.page_size,
    };
  };
}
