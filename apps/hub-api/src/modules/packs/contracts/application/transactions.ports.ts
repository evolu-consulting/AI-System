// CR-097 G1 · GD-FR-01…05: cổng repo của Giao dịch. Mọi hàm chạy trong MỘT tx RLS của người gọi (`PackUow`, role `contracts_rw`,
// tenant + luật thấy M1); số câu SQL mỗi hàm cố định (Luật 4c). Lớp 2 — chỉ kiểu.
import type { TransactionDetail, TransactionListOut, TransactionListQuery } from "@ai/contracts";
import type { DComp } from "../domain/delivery.rules";
import type { DeliveryMove, DeliveryResult } from "../domain/stock.rules";
import type { TxDeal, TxLinePlanned, TxStatus } from "../domain/transactions.rules";

/** Hàng giao dịch đã khoá `FOR UPDATE` (đủ cho luật trạng thái + kho + nghĩa vụ). */
export type TxLocked = {
  id: string;
  status: TxStatus;
  deal: TxDeal;
  rev: number;
  occurred_on: string;
  due_on: string | null;
  valid_until: string | null;
  party_key: string | null;
  product_group: "service" | "goods" | null;
  total: number;
  note: string | null;
  holder: string | null;
  lot_label: string | null;
};

/** Cột đầu giao dịch ghi được (nháp: mọi cột; đã ghi sổ: qua điều chỉnh / mô tả). */
export type TxHeader = {
  deal: TxDeal;
  occurred_on: string;
  due_on: string | null;
  valid_until: string | null;
  partner_name: string;
  partner_tax_id: string | null;
  product_group: "service" | "goods" | null;
  contract_id: string | null;
  note: string | null;
  holder: string | null;
  lot_label: string | null;
  total: number;
};

export type TxLineRow = TxLinePlanned & { id: string };

export type TxObligation = {
  direction: "receive" | "pay";
  amount: number;
  dueDate: string;
  seq: number;
};

export type TransactionsRepo = {
  list(q: TransactionListQuery): Promise<TransactionListOut>;
  detail(id: string): Promise<TransactionDetail | null>;
  lock(id: string): Promise<TxLocked | null>;
  /** HĐ liên kết thấy được (RLS M1). */
  contractVisible(contractId: string): Promise<boolean>;
  /** Thành phần của các SP được gắn (một câu). */
  comps(productIds: readonly string[]): Promise<DComp[]>;
  /** Dòng của một bản (`rev`). */
  lines(id: string, rev: number): Promise<TxLineRow[]>;
  insert(h: TxHeader): Promise<string>;
  /** Sửa cột đầu (nháp: tự do; đã ghi sổ: trigger 0051 kiểm). */
  update(id: string, patch: Partial<TxHeader> & Record<string, unknown>): Promise<void>;
  /** Ghi dòng của bản `rev` (nháp ⇒ xoá bản 0 trước). Một câu. */
  writeLines(id: string, rev: number, lines: readonly TxLineRow[], replace: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  event(
    id: string,
    type: string,
    reason: string | null,
    data: Record<string, unknown>,
  ): Promise<void>;
  applyStock(moves: readonly DeliveryMove[], on: string, id: string): Promise<DeliveryResult>;
  reverseStock(id: string, on: string): Promise<number>;
  /** Σ tiền nghĩa vụ đã xong của giao dịch. */
  doneSum(id: string): Promise<number>;
  /**
   * Huỷ nghĩa vụ mở của giao dịch (lý do) + thêm nghĩa vụ mới (nếu có) — một câu. `voidEvents` ⇒ huỷ luôn sự kiện đối tác gắn các
   * nghĩa vụ của giao dịch (huỷ giao dịch, R32).
   */
  settleObligations(
    id: string,
    o: {
      reason: string | null;
      next: TxObligation | null;
      partyKey: string | null;
      voidEvents: boolean;
    },
  ): Promise<void>;
};
