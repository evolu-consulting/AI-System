// niti-import · hoàn tác MỘT lô nhập (nhãn `--source` trên sự kiện `mgmt_import` của HĐ và `data.mgmt_source` của sự kiện sổ) trong
// MỘT tenant: dry-run (mặc định) chỉ liệt kê; `--apply` xoá từng HĐ gốc của lô qua `contracts.delete_contract` (đường xoá của app,
// một tx mỗi HĐ, phụ lục + hạng mục + đợt + duyệt + nhắc + nhật ký đi theo), huỷ (thêm dòng huỷ — sổ chỉ thêm) sự kiện sổ còn lại của
// lô. Hàng `contracts.files` + object FileBox GIỮ (app không xoá file — `contracts_rw` không có DELETE; không HĐ nào trỏ tới nên không
// thấy trên UI; nhập lại dùng lại đúng hàng + object, không tải lại). Dữ liệu ngoài lô không đụng; phụ lục ngoài lô treo dưới HĐ của
// lô ⇒ từ chối.
import type { Row } from "../domain/plan";
import type { BatchState, OwnerDeps } from "./owner-ports";

type Brief = Omit<BatchState, "contracts"> & { contracts: number };
export type RollbackReport = {
  mode: "dry-run" | "apply";
  source: string;
  tenant: { key: string; id: string };
  before: Brief;
  after: Brief | null;
  contracts: Row[];
  deleted_contracts: number;
  voided_events: number;
  /** Hàng file (id) của lô còn giữ — xoá hẳn: SQL role chủ ở runbook. */
  files_kept: string[];
  error: "ROLLBACK_FOREIGN_CHILDREN" | null;
};

const brief = (s: BatchState): Brief => ({ ...s, contracts: s.contracts.length });

export async function runOwnerRollback(
  o: { source: string; apply: boolean; tenantKey: string },
  d: OwnerDeps,
): Promise<RollbackReport> {
  const t = await d.identity.tenantByKey(o.tenantKey);
  if (!t) throw new Error("TENANT_NOT_FOUND");
  const before = await d.owner.state(t.id, o.source);
  const ids = new Set(before.contracts.map((r) => String(r.id)));
  const roots = before.contracts.filter((r) => !r.parent_id || !ids.has(String(r.parent_id)));
  const r: RollbackReport = {
    mode: o.apply ? "apply" : "dry-run",
    source: o.source,
    tenant: { key: o.tenantKey, id: t.id },
    before: brief(before),
    after: null,
    contracts: before.contracts.map((c) => ({
      id: c.id,
      kind: c.kind,
      number: c.number,
      title: c.title,
    })),
    deleted_contracts: 0,
    voided_events: 0,
    files_kept: before.contracts.map((c) => c.file_id).filter(Boolean) as string[],
    error: before.foreign_children > 0 ? "ROLLBACK_FOREIGN_CHILDREN" : null,
  };
  if (!o.apply || r.error) return r;
  for (const c of roots)
    if (await d.owner.deleteContract(t.id, String(c.id))) r.deleted_contracts++;
  r.voided_events = await d.owner.voidEvents(t.id, o.source);
  r.after = brief(await d.owner.state(t.id, o.source));
  return r;
}
