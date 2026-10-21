// HD7-FR-03…11 · HD7 plan §2/§4 · D7-15: cổng repo của sổ thanh toán (lớp 2 — chỉ kiểu). Mỗi hàm = MỘT câu SQL trong tx `PackUow`
// (role `contracts_rw`, RLS tenant). Thứ tự khoá (D7-15, như HD4 D4-12): `lockContract*` (hàng HĐ) TRƯỚC `lockObligation` (hàng đợt).

import type { NotifyTxRepos } from "../../kit/application/notify";
import type { Direction, ObligationKind, PartnerRole, UndoPatch } from "../domain/ledger.rules";
import type {
  ContractPartner,
  Obligation,
  PartnerEvent,
  PartnerEventCreate,
  PaymentsOut,
  ScheduleRequest,
} from "../domain/ledger.types";
import type { Fault } from "../domain/milestones.rules";
import type { DeliveryRepo } from "./delivery.ports";

export type LockedObligation = {
  id: string;
  contract_id: string;
  party: string | null;
  direction: Direction;
  kind: ObligationKind;
  status: "open" | "done" | "cancelled";
  due_date: string;
  amount: number | null;
  postpones: number;
  reminders: number;
};
export type EventHead = {
  id: string;
  type: string;
  source: string;
  obligation_id: string | null;
  to: string | null;
  was: string | null;
  /** V2-D: mốc giao đã ghi SL đã giao (> 0) ⇒ không huỷ xác nhận (đảo kho ở V2-M). */
  locked: boolean;
};
export type SettleWrite = {
  id: string;
  at: string;
  by: string;
  type: "paid" | "received" | "delivered";
  role: PartnerRole;
  late: number;
  amount: number | null;
  /** V2-A: lỗi do ai khi trễ (null = đúng hạn). */
  fault: Fault | null;
  /** V2-D: SL đã giao theo dòng HĐ, ghi CÙNG câu (`milestone_items.delivered`); [] = không có. */
  delivered: { item_id: string; qty: string; planned: string | null }[];
};
export type PostponeWrite = {
  id: string;
  to: string;
  was: string;
  today: string;
  by: string;
  role: PartnerRole;
  note: string | null;
};
export type RemindWrite = { id: string; today: string; by: string; role: PartnerRole };

export type LedgerWriteRepo = {
  /** Khoá hàng HĐ `FOR NO KEY UPDATE`; null = không có (tenant khác/không tồn tại). */
  lockContract(contractId: string): Promise<{ id: string } | null>;
  /** Khoá hàng HĐ của đợt (đợt chưa bị thay); null = không có. */
  lockContractOf(obligationId: string): Promise<{ id: string } | null>;
  /** Khoá + đọc lại đợt SAU khi đã khoá HĐ. */
  lockObligation(id: string): Promise<LockedObligation | null>;
  replaceSchedule(
    contractId: string,
    rows: ScheduleRequest["rows"],
    by: string,
  ): Promise<Obligation[]>;
  settle(w: SettleWrite): Promise<Obligation>;
  postpone(w: PostponeWrite): Promise<Obligation>;
  remind(w: RemindWrite): Promise<Obligation>;
  eventHead(id: string): Promise<EventHead | null>;
  /** Thêm hàng huỷ (`ON CONFLICT DO NOTHING`); chỉ khi vừa thêm mới áp `patch` lên đợt. Trả sự kiện sau huỷ. */
  voidEvent(w: {
    id: string;
    by: string;
    obligationId: string | null;
    patch: UndoPatch | null;
    /** GAP-D2: lý do huỷ (lưu cạnh hàng huỷ + audit); vắng ⇒ null. */
    reason?: string | null;
  }): Promise<PartnerEvent>;
  /** Ghi tay; null = đối tác không có đợt/sự kiện nào trong tenant. */
  insertManual(w: PartnerEventCreate & { at: string; by: string }): Promise<PartnerEvent | null>;
};

export type LedgerReadRepo = {
  payments(filter: string, today: string): Promise<PaymentsOut>;
  /** Như `payments` nhưng nguyên văn JSON của Postgres, hai nửa độc lập (đầu: tổng + total; thân: hàng) — Luật 4c. */
  paymentsHead(filter: string, today: string): Promise<string>;
  paymentsRows(filter: string, today: string): Promise<string>;
  obligations(q: {
    contract_id?: string;
    party?: string;
    status?: string;
    direction?: string;
    due_before?: string;
  }): Promise<Obligation[]>;
  events(party: string, role: string | null): Promise<PartnerEvent[]>;
  contractPartner(contractId: string): Promise<ContractPartner | null>;
};

export type LedgerRepos = {
  ledger: LedgerWriteRepo & LedgerReadRepo;
  delivery: DeliveryRepo;
} & NotifyTxRepos;

/** Lỗi luật ⇒ mã contract (`LEDGER_ERRORS`) ở route. */
export class LedgerFail extends Error {
  constructor(
    readonly kind:
      | "not_found"
      | "done"
      | "postpone_date"
      | "system"
      | "event_type"
      | "adjust"
      | "forbidden"
      | "locked",
  ) {
    super(kind);
  }
}
