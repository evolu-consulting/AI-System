// niti-import · cổng của chế độ nhập MỘT tài khoản (`--owner-email` + `--owner-username`) và hoàn tác lô. Lớp 2 — chỉ kiểu.
import type { Row, TableName } from "../domain/plan";
import type { ImportDeps, ImportOpts } from "./ports";

/** Trạng thái lô ở đích (nhãn `mgmt_source`): HĐ (dòng rút gọn) + số hàng + tổng tiền — một câu. */
export type BatchState = {
  contracts: Row[];
  items: number;
  approvals: number;
  obligations: number;
  obligations_amount: bigint;
  events: number;
  reminders: number;
  files: number;
  partner_events: number;
  partner_events_amount: bigint;
  partner_events_voided: number;
  ratings: number;
  /** HĐ KHÔNG thuộc lô nhưng là phụ lục của HĐ trong lô (tạo sau nhập) ⇒ hoàn tác từ chối. */
  foreign_children: number;
};

export type OwnerStore = {
  /** MỘT tx: chèn mọi bảng của một đơn vị (thứ tự FK) + đánh dấu mốc nhắc đã qua (ngày `today`) cho HĐ vừa chèn. */
  writeUnit(
    tenantId: string,
    tables: [TableName, Row[]][],
    today: string,
  ): Promise<Partial<Record<TableName, number>>>;
  state(tenantId: string, source: string): Promise<BatchState>;
  /** `contracts.delete_contract` (một tx; phụ lục đi theo HĐ cha). */
  deleteContract(tenantId: string, contractId: string): Promise<boolean>;
  /** Huỷ (thêm dòng huỷ) mọi sự kiện sổ của lô chưa huỷ — sổ chỉ thêm. */
  voidEvents(tenantId: string, source: string): Promise<number>;
};

/** Siêu dữ liệu của file export (đã lọc theo chủ lúc export). */
export type ExportMeta = {
  owner_email: string;
  exported_at: string;
  source_orgs: string[];
  excluded: Record<string, number>;
  not_imported: Record<string, number>;
  counts_all: Record<string, number>;
};

export type OwnerOpts = Pick<ImportOpts, "source" | "apply" | "batch" | "actorId"> & {
  tenantKey: string;
  ownerEmail: string;
  ownerUsername: string;
  /** Ngày hôm nay ở múi tenant (YYYY-MM-DD) — mốc nhắc ≤ ngày này coi như đã gửi. */
  today: string;
  meta: ExportMeta | null;
};

export type OwnerDeps = ImportDeps & { owner: OwnerStore };
