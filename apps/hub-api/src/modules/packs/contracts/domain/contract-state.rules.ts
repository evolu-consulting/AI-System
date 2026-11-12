// CR-127 K1a · BR-01/02/03/04 · spec §3: cổng đổi trạng thái HĐ — bảng chuyển MỘT chỗ (thuần). 4 trạng thái
// DRAFT / PROCESSING / REJECT / DONE (khớp `CONTRACT_STATUSES` ở `PC/fields.ts`; domain không import ngoài built-in nên khai lại).
// Adapter `adapters/contract-state.repo.ts#applyTransition` áp kết quả bằng MỘT câu CTE (CAS `status = any(from)`).
// DONE và REJECT là kết thúc (#15, #16): sửa DONE ⇒ phiên bản mới; REJECT ⇒ chỉ "tạo HĐ mới từ văn bản này" (#1).

export const CONTRACT_STATES = ["draft", "processing", "reject", "done"] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];
export const isContractState = (s: unknown): s is ContractState =>
  (CONTRACT_STATES as readonly unknown[]).includes(s);

export const EXTRACT_STATES = ["reading", "failed", "ready"] as const;
export type ExtractState = (typeof EXTRACT_STATES)[number];

/** Sự kiện → trạng thái nguồn DUY NHẤT được phép (bảng §3). */
export const FROM_OF = {
  extracted: "draft",
  extract_failed: "draft",
  submit: "draft",
  flow_approved: "processing",
  flow_rejected: "processing",
  flow_returned: "processing",
  flow_cancelled: "processing",
  flow_failed: "processing",
  flow_not_launched: "processing",
  withdraw: "processing",
  inbox_accept: "processing",
  inbox_return: "processing",
  inbox_reject: "processing",
  partner_returned: "processing",
  partner_revised: "draft",
  sign_session_done: "processing",
  sign_session_declined: "processing",
  sign_session_cancelled: "processing",
  sign_session_expired_resend: "processing",
  sign_session_expired_stop: "processing",
} as const satisfies Record<string, ContractState>;
export type ContractEv = keyof typeof FROM_OF;

/** Cột phụ cổng ghi cùng câu (R#25). `confirm` = vào DONE: `confirmed_*` (trigger K1 lấp `locked_*`) + `effect`. */
export type TransitionCols = {
  extractState?: ExtractState;
  submitRoundInc?: true;
  submittedBy?: true;
  confirm?: true;
};
/** Việc kèm theo (người gọi/adapter làm trong cùng tx). */
export type SideEffect =
  | "emit_submitted"
  | "record_submission"
  | "event_no_flow"
  | "emit_received"
  | "notify_claimed"
  | "refresh_effect"
  | "done_hook";
export type TransitionCtx = { hasFlow?: boolean };
export type TransitionOk = { to: ContractState; cols: TransitionCols; sideEffects: SideEffect[] };
export type TransitionResult = TransitionOk | { error: "STATE_CONFLICT" };

const DONE: TransitionOk = {
  to: "done",
  cols: { confirm: true },
  sideEffects: ["refresh_effect", "done_hook"],
};
const go = (to: ContractState, cols: TransitionCols = {}, sideEffects: SideEffect[] = []) => ({
  to,
  cols,
  sideEffects,
});

function plan(ev: ContractEv, ctx: TransitionCtx): TransitionOk {
  switch (ev) {
    case "extracted":
      return go("draft", { extractState: "ready" });
    case "extract_failed":
      return go("draft", { extractState: "failed" });
    case "submit":
      return ctx.hasFlow
        ? go("processing", { submitRoundInc: true, submittedBy: true }, [
            "emit_submitted",
            "record_submission",
          ])
        : go("done", { submitRoundInc: true, submittedBy: true, confirm: true }, [
            "record_submission",
            "event_no_flow",
            "refresh_effect",
            "done_hook",
          ]);
    case "flow_approved":
    case "inbox_accept":
    case "sign_session_done":
      return { ...DONE, cols: { ...DONE.cols }, sideEffects: [...DONE.sideEffects] };
    case "flow_rejected":
    case "inbox_reject":
    case "sign_session_declined":
    case "sign_session_expired_stop":
      return go("reject");
    case "withdraw":
      return go("draft", {}, ["notify_claimed"]);
    case "partner_revised":
      return go("processing", { submitRoundInc: true }, ["emit_received"]);
    default:
      // flow_returned, flow_cancelled/failed/not_launched, inbox_return, partner_returned, sign_session_cancelled/expired_resend
      return go("draft");
  }
}

/** Bảng §3: chỉ chuyển khi `from` đúng nguồn của sự kiện; còn lại ⇒ STATE_CONFLICT (người gọi trả 409 / hook bỏ qua). */
export function transition(
  from: ContractState,
  ev: ContractEv,
  ctx: TransitionCtx,
): TransitionResult {
  if (FROM_OF[ev] !== from) return { error: "STATE_CONFLICT" };
  return plan(ev, ctx);
}

/** Cách tạo HĐ (INSERT) — R#2. */
export const INITIAL_KINDS = [
  "upload",
  "framework",
  "recreate",
  "renewal",
  "create_from_step",
  "deal",
  "promote",
  "create_manual",
  "mgmt_import",
  "cks",
  "partner_inbox",
] as const;
export type InitialKind = (typeof INITIAL_KINDS)[number];
const CREATED_DONE: readonly InitialKind[] = [
  "deal",
  "promote",
  "create_manual",
  "mgmt_import",
  "cks",
];

export type InitialState = {
  ev: "created" | "created_done" | "partner_received";
  status: ContractState;
  extractState: ExtractState;
  sideEffects: SideEffect[];
};

/** #1 / #1b: HĐ thường ⇒ draft (đang đọc khi có tệp chờ AI); giao dịch/nâng/tạo tay/nhập/CKS ⇒ done + tính hiệu lực. */
export function initialState(kind: InitialKind, o: { reading?: boolean } = {}): InitialState {
  // #9 · CR-127 K8: HĐ nhận từ đối tác vào thẳng PROCESSING (quy trình nhận hoặc người phụ trách quyết) + phát `contract.received`.
  if (kind === "partner_inbox")
    return {
      ev: "partner_received",
      status: "processing",
      extractState: "ready",
      sideEffects: ["emit_received"],
    };
  if (CREATED_DONE.includes(kind))
    return {
      ev: "created_done",
      status: "done",
      extractState: "ready",
      sideEffects: ["refresh_effect"],
    };
  return {
    ev: "created",
    status: "draft",
    extractState: o.reading ? "reading" : "ready",
    sideEffects: [],
  };
}
