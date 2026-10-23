// V2-A · HD-11: cổng repo mốc HĐ (lớp 2 — chỉ kiểu). Mỗi hàm = MỘT câu SQL trong tx `PackUow` (RLS tenant). Thứ tự khoá như
// HD7 D7-15: hàng HĐ (`FOR NO KEY UPDATE`) TRƯỚC hàng mốc (`FOR UPDATE`).
import type { DbKind, Deal, Fault, Owner } from "../domain/milestones.rules";
import type { DeliveryRepo } from "./delivery.ports";

/** Hàng mốc thô (cột `contracts.obligations`; qty/amount có thể về chuỗi NUMERIC). */
export type MilestoneRow = {
  id: string;
  contract_id: string;
  kind: DbKind;
  direction: "pay" | "receive";
  title: string | null;
  seq: number;
  due_date: string;
  owner: Owner;
  qty: number | string | null;
  amount: number | string | null;
  status: "open" | "done" | "cancelled";
  done_at: string | null;
  fault: Fault | null;
  postponed_to: string | null;
  source: "manual" | "ai" | "default" | "cks";
};
/** Mốc vừa ghi + đủ dữ liệu tính 5.4a (các mốc còn hiệu lực của HĐ + giá trị/hoa hồng) — cùng câu ghi. */
export type MilestoneWritten = {
  m: MilestoneRow;
  deal: Deal | null;
  value: number | string | null;
  pct: number | string | null;
  fixed: number | string | null;
  peers: Pick<MilestoneRow, "id" | "kind" | "direction" | "amount" | "status">[];
};
export type MilestoneWrite = {
  kind: DbKind;
  direction: "pay" | "receive";
  title: string;
  owner: Owner;
  due_date: string;
  qty: number | null;
  amount: number | null;
};

export type MilestonesRepo = {
  /** Khoá HĐ; null = không có (tenant khác/không tồn tại). `n` = số mốc còn hiệu lực. */
  lockContract(
    contractId: string,
  ): Promise<{ deal: Deal | null; n: number; locked: boolean } | null>;
  /** Khoá HĐ của mốc (mốc chưa bị gỡ); null = không có. */
  lockContractOf(id: string): Promise<{ deal: Deal | null; locked: boolean } | null>;
  /** Khoá + đọc lại mốc SAU khi đã khoá HĐ. */
  lockRow(id: string): Promise<MilestoneRow | null>;
  insert(contractId: string, w: MilestoneWrite, by: string): Promise<MilestoneWritten>;
  update(id: string, w: MilestoneWrite & { moved: boolean }, by: string): Promise<MilestoneWritten>;
  /** Gỡ mốc chưa xác nhận (`replaced` — sổ chỉ thêm, không DELETE) + huỷ dòng quá hạn của nó. */
  remove(id: string, by: string): Promise<boolean>;
};
export type MilestoneRepos = { milestones: MilestonesRepo; delivery: DeliveryRepo };

export class MilestoneFail extends Error {
  constructor(readonly kind: "not_found" | "confirmed" | "invalid" | "locked") {
    super(kind);
  }
}
