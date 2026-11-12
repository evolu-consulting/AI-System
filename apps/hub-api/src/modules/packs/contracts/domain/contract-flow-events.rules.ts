// CR-122 · A1 · FLOW2-FR-12/15/18/19 · luật thuần: sự kiện flow của gói Hợp đồng (khoá, event_id ổn định, kết cục → việc của HĐ).
// Khoá/dữ kiện/kết cục khai ở manifest `contracts.manifest.ts` `events[]` — file này chỉ là bản sao tên cho lớp trong (domain không
// import `@ai/contracts`, ADR-0023); test `contract-flow-events.rules.test.ts` khớp manifest.

export const CONTRACTS_PACK = "contracts";
export const EV_SUBMITTED = "contract.submitted";
export const EV_UPLOADED = "contract.uploaded";
export const EV_APPROVED = "contract.approved";
/** CR-124 · q3 · bên NHẬN: HĐ đối tác gửi tới (ref = id HĐ nhận). */
export const EV_RECEIVED = "contract.received";
export const CONTRACT_EVENTS = [EV_SUBMITTED, EV_UPLOADED, EV_APPROVED, EV_RECEIVED] as const;
export type ContractEvent = (typeof CONTRACT_EVENTS)[number];

/** Khoá dữ kiện đã khai (`AppFactDecl.key`) theo sự kiện. */
export const FACT_KEYS: Record<ContractEvent, readonly string[]> = {
  [EV_SUBMITTED]: [
    "total_value",
    "deal",
    "creator_department",
    "new_partner",
    "importance",
    "submitter_group_ids",
    "partner_score",
    "product_ids",
  ],
  [EV_APPROVED]: ["total_value", "deal", "creator_department", "new_partner"],
  [EV_UPLOADED]: ["file_type", "uploader_department"],
  [EV_RECEIVED]: [
    "total_value",
    "importance",
    "contract_type",
    "new_partner",
    "sender_verified",
    "sign_together", // CR-127 P2 · phát cùng sự kiện (partner-inbox.repo), không đọc lại từ HĐ
  ],
};

/**
 * `event_id` ổn định theo bản ghi + phiên bản: gửi duyệt/được duyệt theo LƯỢT DUYỆT (`approvals.id`, mỗi lần gửi lại là lượt mới),
 * tải lên theo HĐ (mỗi lần tải là một hàng HĐ mới, kể cả "Tải bản cập nhật"). Ghi lại cùng id ⇒ `hub.emit_flow_event` bỏ qua.
 */
export function contractEventId(event: ContractEvent, contractId: string, versionKey?: string) {
  return versionKey ? `${event}:${contractId}:${versionKey}` : `${event}:${contractId}`;
}

export type ContractOutcome = "approved" | "rejected" | "returned";
export const CONTRACT_OUTCOMES: readonly string[] = ["approved", "rejected", "returned"];

/** Lượt duyệt kết thúc ở trạng thái nào theo kết cục (`approvals_status_ck`): Trả lại ⇒ lượt đóng `cancelled`, HĐ về Nháp. */
export const APPROVAL_STATUS_OF: Record<ContractOutcome, "done" | "rejected" | "cancelled"> = {
  approved: "done",
  rejected: "rejected",
  returned: "cancelled",
};

export const isContractOutcome = (o: string): o is ContractOutcome => CONTRACT_OUTCOMES.includes(o);

/** Chọn đúng các khoá được hỏi; khoá vắng ⇒ không có (≡ null ở node Nếu). */
export function pickFacts<V>(all: Readonly<Record<string, V>>, keys: readonly string[]) {
  const out: Record<string, V> = {};
  for (const k of keys) if (k in all) out[k] = all[k] as V;
  return out;
}
