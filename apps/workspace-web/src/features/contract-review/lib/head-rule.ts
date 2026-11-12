// CR-127 · U5 · BR-35…40 · M10: luật thuần đầu trang chi tiết HĐ theo 4 trạng thái + vai. Chỉ DRAFT là form; PROCESSING/DONE/REJECT là chữ đọc.
// - Một băng lý do (`banner`) thay 6 dải cũ; nút nào bấm được lấy từ `can` của hub (đã tính quyền), nút không bấm được ⇒ `why` (lý do hiện cạnh nút).
// - Thanh dính (Huỷ + Lưu nháp + Xác nhận và lưu) chỉ ở DRAFT lần đầu (chưa gửi vòng nào).
import type { ContractCan, ContractStatus, ExtractState } from "@ai/contracts/pack-contracts";

export type HeadBanner =
  | "reading"
  | "readFailed"
  | "returned"
  | "waiting"
  | "rejected"
  | "hold"
  | "superseded"
  | "inbox"
  | null;

export type HeadRuleIn = {
  status: ContractStatus;
  extractState: ExtractState;
  /** Vòng đã gửi (0 = chưa gửi lần nào; > 0 và DRAFT = bị trả lại / rút về). */
  round: number;
  superseded: boolean;
  /** Vai ghi (đã loại bản bị thay). */
  write: boolean;
  can: ContractCan;
  /** Đang tạm khoá thực hiện. */
  hold: boolean;
  /** Đã tải trạng thái duyệt; bước duyệt hiện tại (null = tenant tắt duyệt / chưa có lượt). */
  approvalLoaded: boolean;
  approvalStep: string | null;
  /** Thẻ duyệt đang cho người này "Xác nhận" (bật duyệt, cấp 1). */
  approvalConfirm: boolean;
  edited: boolean;
  /** Đã gửi duyệt (thẻ còn bản cũ / lượt chờ flow): không còn Xác nhận và lưu / Lưu nháp. */
  submitted?: boolean;
  /** K8: HĐ đối tác gửi tới, công ty chưa có quy trình nhận ⇒ người phụ trách quyết (detail chưa trả trường ⇒ undefined). */
  awaitingDecision?: boolean | undefined;
  /** NF1: công ty chưa có quy trình duyệt khớp ⇒ Gửi duyệt bị chặn (`ContractDetail.submit_block`). */
  submitBlock?: "no_flow" | null | undefined;
};

export type HeadRule = {
  /** Ô thông tin sửa được (chỉ DRAFT, AI đã đọc xong). */
  canSave: boolean;
  sticky: boolean;
  /** "Lưu nháp" (DRAFT, thẻ duyệt không đang giữ nút Xác nhận). */
  draftSave: boolean;
  /** "Xác nhận và lưu" của trang (DRAFT lần đầu, tenant tắt duyệt). */
  confirmSave: boolean;
  /** "Gửi lại" (DRAFT sau khi bị trả lại/rút về). */
  resubmit: boolean;
  withdraw: boolean;
  recreate: boolean;
  newVersion: boolean;
  hold: boolean;
  release: boolean;
  /** HĐ nhận chờ người phụ trách quyết: 3 nút Đồng ý / Trả lại để sửa / Từ chối. */
  inboxDecision: boolean;
  banner: HeadBanner;
  /** NF1 · lý do + bước kế hiện cạnh nút chính khi không Gửi duyệt được (chưa có quy trình): nút chính là "Lưu nháp"; "Gửi lại" bị khoá. */
  submitBlocked: boolean;
  /** Nút bị khoá vì sao (hiện cạnh nút); null = không khoá. */
  why: "reading" | "failed" | null;
  cancel: "reset" | "back";
};

function bannerOf(i: HeadRuleIn): HeadBanner {
  if (i.superseded) return "superseded";
  if (i.hold && i.status === "done") return "hold";
  if (i.awaitingDecision) return "inbox";
  if (i.extractState === "reading") return "reading";
  if (i.extractState === "failed" && i.status === "draft") return "readFailed";
  if (i.status === "draft") return i.round > 0 ? "returned" : null;
  if (i.status === "processing") return "waiting";
  if (i.status === "reject") return "rejected";
  return null;
}

export function headRule(i: HeadRuleIn): HeadRule {
  const draft = i.status === "draft";
  const ready = i.extractState === "ready";
  const canSave = draft && i.write && !i.superseded && ready;
  const first = canSave && i.round === 0 && !i.submitted;
  const blocked = canSave && i.submitBlock === "no_flow";
  const off = i.approvalLoaded && i.approvalStep === null;
  return {
    canSave,
    sticky: first,
    draftSave: first && !i.approvalConfirm,
    confirmSave: first && off && !i.approvalConfirm && !blocked,
    resubmit: canSave && i.round > 0 && (i.can.submit || blocked),
    withdraw: i.can.withdraw,
    recreate: i.can.recreate,
    newVersion: i.can.new_version,
    hold: i.can.hold,
    release: i.can.release,
    inboxDecision: i.awaitingDecision === true,
    banner: bannerOf(i),
    submitBlocked: blocked,
    why: draft && i.extractState === "reading" ? "reading" : draft && !ready ? "failed" : null,
    cancel: i.edited ? "reset" : "back",
  };
}

// CR-128 (e): gom nút đầu trang — MỘT nút chính + menu «Thao tác ▾».
export type HeadActKey =
  | "approvalConfirm"
  | "pageConfirm"
  | "approve"
  | "pass"
  | "resubmit"
  | "release"
  | "newVersion"
  | "recreate"
  | "withdraw"
  | "hold"
  | "back"
  | "reject"
  | "delete";

export type HeadActIn = {
  rule: Pick<
    HeadRule,
    | "resubmit"
    | "submitBlocked"
    | "confirmSave"
    | "withdraw"
    | "recreate"
    | "newVersion"
    | "hold"
    | "release"
  >;
  /** Thẻ duyệt (cùng `ApprovalView`): chỉ các cờ cần. */
  view: { confirm: boolean; approve: boolean; reject: boolean; pass?: boolean; back?: boolean };
  canDelete: boolean;
};

export type HeadMenuEntry = {
  key: HeadActKey;
  danger?: boolean;
  /** Khoá i18n lý do khi mục bị khoá (hiện mờ + dòng phụ). */
  whyKey?: string;
};

export type HeadActs = { primary: HeadActKey | null; menu: HeadMenuEntry[] };

/** Ưu tiên nút chính: Duyệt/Xác nhận > Gửi lại > Mở khoá > Tải phiên bản mới > Tạo lại. Còn lại vào menu; Xoá cuối. */
export function headActs(i: HeadActIn): HeadActs {
  const { rule: r, view: v } = i;
  const present: HeadActKey[] = [];
  const add = (on: boolean | undefined, k: HeadActKey) => on && present.push(k);
  add(v.confirm, "approvalConfirm");
  add(r.confirmSave, "pageConfirm");
  add(v.approve, "approve");
  add(v.pass, "pass");
  add(r.resubmit, "resubmit");
  add(r.release, "release");
  add(r.newVersion, "newVersion");
  add(r.recreate, "recreate");
  add(r.withdraw, "withdraw");
  add(r.hold, "hold");
  add(v.back, "back");
  add(v.reject, "reject");
  const blocked = (k: HeadActKey) => k === "resubmit" && r.submitBlocked;
  const primary =
    present.find(
      (k) => !blocked(k) && k !== "withdraw" && k !== "hold" && k !== "back" && k !== "reject",
    ) ?? null;
  const menu: HeadMenuEntry[] = present
    .filter((k) => k !== primary)
    .map((key) => (blocked(key) ? { key, whyKey: "contracts.u5.err.NO_APPROVAL_FLOW" } : { key }));
  if (i.canDelete) menu.push({ key: "delete", danger: true });
  return { primary, menu };
}
