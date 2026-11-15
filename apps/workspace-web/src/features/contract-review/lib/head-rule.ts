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

export type PageConfirmWhy = "no_flow" | "not_submitter" | "step_open" | null;

/** Bước thẻ duyệt đã kết thúc (huỷ / từ chối / xong): không còn lượt đang mở ⇒ coi như không có thẻ duyệt. Máy chủ ánh xạ lượt `failed` (đọc AI hỏng) ⇒ `cancelled` (`approval-run.rules` STEP, `cardStepOf`) nên không cần khoá riêng. */
const ENDED_STEPS: ReadonlySet<string> = new Set(["cancelled", "rejected", "done"]);

export type HeadRule = {
  /** Ô thông tin sửa được (chỉ DRAFT, AI đã đọc xong). */
  canSave: boolean;
  sticky: boolean;
  /** CR-135 Q12: đổi tên HĐ tại chỗ — chỉ DRAFT, người sửa được nháp (cùng điều kiện ô sửa được). */
  rename: boolean;
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
  /** Nháp lần đầu mà «Gửi duyệt» KHÔNG bấm được ⇒ nút vẫn hiện, khoá, kèm lý do (G3, không im lặng): chưa có quy trình · không phải người tạo/phụ trách · còn lượt duyệt đang mở. */
  pageConfirmWhy: PageConfirmWhy;
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

/** Tenant tắt duyệt / chưa có lượt đang mở. Lượt đã kết thúc (vd lượt đọc AI hỏng còn dính HĐ nhập tay) KHÔNG phải «bật duyệt cấp 1» — trước đây bước «cancelled» làm mất Gửi duyệt. */
function approvalOff(i: HeadRuleIn): boolean {
  return i.approvalLoaded && (i.approvalStep === null || ENDED_STEPS.has(i.approvalStep));
}

/** Vì sao «Gửi duyệt» của trang khoá (nháp lần đầu, không phải nút của thẻ duyệt). */
function whyOf(i: HeadRuleIn, blocked: boolean, off: boolean): PageConfirmWhy {
  if (blocked) return "no_flow";
  if (!i.can.submit) return "not_submitter";
  return i.approvalLoaded && !off ? "step_open" : null;
}

export function headRule(i: HeadRuleIn): HeadRule {
  const draft = i.status === "draft";
  const ready = i.extractState === "ready";
  const canSave = draft && i.write && !i.superseded && ready;
  const first = canSave && i.round === 0 && !i.submitted;
  const blocked = canSave && i.submitBlock === "no_flow";
  const off = approvalOff(i);
  const confirmSave = first && off && !i.approvalConfirm && !blocked && i.can.submit;
  return {
    canSave,
    sticky: first,
    rename: canSave,
    draftSave: first && !i.approvalConfirm,
    confirmSave,
    pageConfirmWhy: first && !i.approvalConfirm && !confirmSave ? whyOf(i, blocked, off) : null,
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
  | "saveDraft"
  | "cancel"
  | "delete";

export type HeadActIn = {
  rule: Pick<
    HeadRule,
    | "sticky"
    | "resubmit"
    | "submitBlocked"
    | "confirmSave"
    | "pageConfirmWhy"
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

export type HeadActs = {
  primary: HeadActKey | null;
  menu: HeadMenuEntry[];
  /** Nút chính đang khoá ⇒ khoá i18n lý do (hiện cạnh nút). */
  primaryWhyKey?: string;
};

const WHY_KEY: Record<NonNullable<PageConfirmWhy>, string> = {
  no_flow: "contracts.u5.err.NO_APPROVAL_FLOW",
  not_submitter: "contracts.u5.why.notSubmitter",
  step_open: "contracts.u5.why.stepOpen",
};

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
  // CR-135 Q2: nháp lần đầu — «Lưu nháp» + «Huỷ» vào menu (đầu danh sách); không có nút chính ⇒ «Lưu nháp» lên làm nút chính.
  let main = primary;
  let primaryWhyKey: string | undefined;
  if (r.sticky) {
    // Nháp lần đầu không Gửi duyệt được ⇒ «Gửi duyệt» vẫn là nút chính (khoá + lý do), «Lưu nháp» xuống menu.
    if (main === null && r.pageConfirmWhy) {
      main = "pageConfirm";
      primaryWhyKey = WHY_KEY[r.pageConfirmWhy];
    }
    if (main === null) main = "saveDraft";
    menu.unshift(...(main === "saveDraft" ? [] : [{ key: "saveDraft" as const }]), {
      key: "cancel" as const,
    });
  }
  if (i.canDelete) menu.push({ key: "delete", danger: true });
  return { primary: main, menu, ...(primaryWhyKey ? { primaryWhyKey } : {}) };
}
