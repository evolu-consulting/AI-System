// HD-FR-07 · HD-AC03 · HD-AC04 · HD-AC05 · HD-BR-03 · D-03 · D-18 · HD1 plan §6: danh sách hợp đồng của tenant token —
// lọc/sắp/phân trang `page/page_size/total` trong MỘT câu SQL (tx RLS `PackUow`). `signer` ⇒ khoá người, `q` ⇒ mẫu LIKE đã fold.
import type { PackUow, PackWho } from "../../kit/public";
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
    docType: arr(q.doc_type),
    nest: q.nest === "1",
    docs: q.nest === "1" || arr(q.doc_type) !== null,
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

/** `fromRuns` = id run mà thẻ duyệt dựng bước từ run (event flow) — bước đầu là bước duyệt, không phải bước soạn. */
type StepLabels = (
  who: PackWho,
  runIds: readonly string[],
  fromRuns: ReadonlySet<string>,
) => Promise<Map<string, string | null>>;

/** CR-123 · u10 · thêm MỘT khoá `step_label` vào từng hàng (null ⇒ giữ nhãn trạng thái); không có cầu ⇒ giữ nguyên hàng. */
async function withStepLabels<Row>(
  stepLabels: StepLabels | undefined,
  who: PackWho,
  items: Row[],
  runs: readonly { id: string; run: string; from_run?: boolean }[] = [],
): Promise<Row[]> {
  const labels =
    stepLabels && runs.length > 0
      ? await stepLabels(
          who,
          runs.map((x) => x.run),
          new Set(runs.filter((x) => x.from_run === true).map((x) => x.run)),
        )
      : new Map<string, string | null>();
  const runOf = new Map(runs.map((x) => [x.id, x.run]));
  return items.map((it) =>
    typeof it === "object" && it !== null
      ? {
          ...it,
          step_label: labels.get(runOf.get((it as unknown as { id: string }).id) ?? "") ?? null,
        }
      : it,
  );
}

export function listContracts<Row>(d: {
  uow: PackUow<{ contracts: Pick<ContractsReadRepo<Row, unknown>, "list"> }>;
  /** V2-A: ngày lịch tenant (giai đoạn/quá hạn); vắng ⇒ ngày UTC. */
  today?: (tenantId: string) => Promise<string>;
  /** CR-123 · u10 · nhãn bước hiện tại theo id run engine (MỘT lô cho cả trang, cùng nguồn thẻ duyệt); vắng ⇒ không có `step_label`. */
  stepLabels?: StepLabels;
}): ListContracts<Row> {
  return async (who, q) => {
    const want = q.include === "progress";
    const today =
      want || q.due
        ? await (d.today?.(who.tenantId) ?? new Date().toISOString().slice(0, 10))
        : undefined;
    const f = toListFilter(q, today);
    const p = await d.uow.tenant(who, (r) => r.contracts.list(f, want ? today : undefined));
    const items = await withStepLabels(d.stepLabels, who, p.items, p.step_runs);
    return {
      items,
      total: p.total,
      parents: p.parents,
      ...(want ? { progress: p.progress ?? [] } : {}),
      ...(f.docs ? { docs: p.docs ?? [], children: p.children ?? [] } : {}),
      page: q.page,
      page_size: q.page_size,
    };
  };
}
