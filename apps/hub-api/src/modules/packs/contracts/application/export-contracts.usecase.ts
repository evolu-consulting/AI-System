// Gap #8 · xuất danh sách HĐ ra .xlsx/.csv: cùng bộ lọc với danh sách (không phân trang), trần số dòng; đọc MỘT tx RLS của người gọi
// (`PackUow.tenant`). Trả hàng thô + ngữ cảnh định dạng (ngày/múi giờ tenant, tên người phụ trách); việc ghi tệp ở adapter.
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ExportInput, OwnerNames } from "../domain/export.rules";
import { toListFilter } from "./list-contracts.usecase";
import type { ContractExportRow, ContractListInput, ContractsReadRepo } from "./ports";

export type ExportResult = {
  rows: (ExportInput & Pick<ContractExportRow, "ownerUserId">)[];
  /** Tổng hàng khớp bộ lọc (có thể > trần). */
  total: number;
  /** Đã cắt ở trần `cap` dòng. */
  truncated: boolean;
  today: string;
  timeZone: string;
  owners: OwnerNames;
};
export type ExportContracts = (
  who: PackWho,
  q: Omit<ContractListInput, "page" | "page_size" | "include">,
) => Promise<ExportResult>;

export function exportContracts(d: {
  uow: PackUow<{ contracts: Pick<ContractsReadRepo<unknown, unknown>, "exportRows"> }>;
  today: (tenantId: string) => Promise<string>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  owners: (who: PackWho) => Promise<OwnerNames>;
  cap: number;
}): ExportContracts {
  return async (who, q) => {
    const [today, timeZone] = await Promise.all([
      d.today(who.tenantId),
      d.timeZoneOf(who.tenantId),
    ]);
    const f = toListFilter({ ...q, page: 1, page_size: 1 }, today);
    const out = await d.uow.tenant(who, (r) => r.contracts.exportRows(f, d.cap));
    const truncated = out.rows.length > d.cap;
    const rows = truncated ? out.rows.slice(0, d.cap) : out.rows;
    const ids = new Set(rows.flatMap((r) => (r.ownerUserId ? [r.ownerUserId] : [])));
    const owners = ids.size ? await d.owners(who) : new Map<string, string>();
    return { rows, total: out.total, truncated, today, timeZone, owners };
  };
}
