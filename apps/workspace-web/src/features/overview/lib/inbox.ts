// CR-126 · «Việc của tôi»: MỘT kiểu dòng cho mọi nguồn (ký · duyệt HĐ · việc yêu cầu). Thuần: dựng dòng, câu tóm tắt «điều đang duyệt»,
// sắp (hạn gần trước, rồi chờ lâu nhất), lọc chip. `now` truyền vào để test không phụ thuộc đồng hồ.
import type { ReviewTaskListResponse } from "@ai/contracts/chat";
import type { MyWorkApproval, MyWorkInboxDecision, MyWorkSign } from "@ai/contracts/pack-contracts";
import { claimView } from "~/platform/flow/lib/claim";
import { type ApprovalTarget, approvalTarget, approvalTitle } from "./approvals";

type TaskItem = ReviewTaskListResponse["items"][number];
export type InboxFilter = "all" | "approve" | "sign";

export type InboxRow = {
  kind: "approval" | "sign" | "request" | "milestone" | "inbox";
  key: string;
  tag: string;
  /** Câu tóm tắt: «<quy trình> · <đối tác> · <số tiền> · <người đề xuất> · <ngày>» (thiếu phần nào bỏ phần đó). */
  summary: string;
  /** Hạn (ISO) nếu có; late = quá hạn. */
  due: { at: string; late: boolean } | null;
  escalated: boolean;
  /** Lúc việc tới (ISO) — sắp khi không có hạn; hiện ở dòng. */
  since: string | null;
  to: ApprovalTarget;
  /** Mở trang yêu cầu của lượt (testid cũ `requests-waiting-row`). */
  runId?: string;
  /** CR-127 · U4 · nhận việc nhóm: «Chưa ai nhận» / «{X} đang xử lý» / «Bạn đang giữ» (vắng = việc đích danh). */
  claim?: { state: "unclaimed" | "mine" | "other"; holder: string | null };
  /** «Cần tất cả»: «x/n» đã duyệt. */
  votes?: string;
  /** «Thay {A}» — việc giao cho người khác mà mình làm thay (uỷ quyền). */
  behalf?: string;
  /** HĐ đối tác gửi, công ty chưa có quy trình nhận: người phụ trách quyết ngay trên dòng (3 nút). */
  inbox?: { contractId: string; sender: string };
};

type ClaimFields = Pick<InboxRow, "claim" | "votes" | "behalf">;
/** Trường nhận việc/phiếu/thay của một task (thuần; việc đích danh không có claim). */
export function claimFields(task: Parameters<typeof claimView>[0]): ClaimFields {
  const v = claimView(task);
  return {
    ...(v.claimable && v.state !== "none" ? { claim: { state: v.state, holder: v.holder } } : {}),
    ...(v.votesText ? { votes: v.votesText } : {}),
    ...(v.onBehalfOf ? { behalf: v.onBehalfOf } : {}),
  };
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const fmtMoney = (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) ? `${new Intl.NumberFormat("vi-VN").format(n)} đ` : raw;
};

/** Ghép các phần có giá trị bằng « · ». */
export const joinParts = (parts: readonly (string | null | undefined)[]): string =>
  parts.filter((p): p is string => !!p && p.trim() !== "").join(" · ");

/** Câu tóm tắt của một việc yêu cầu/quy trình. */
export function requestSummaryLine(i: TaskItem): string {
  const r = i.process_run;
  return joinParts([
    r.process.name,
    r.request?.partner,
    r.request?.amount ? fmtMoney(r.request.amount) : null,
    r.started_by.display_name,
    fmtDate(i.task.created_at),
  ]);
}

export type InboxInput = {
  approvals: readonly MyWorkApproval[];
  signing: readonly MyWorkSign[];
  /** CR-127 · K8 · HĐ nhận chờ chính người xem quyết (không quy trình). */
  inbox?: readonly MyWorkInboxDecision[];
  /** Việc yêu cầu còn lại (đã bỏ task trùng với danh sách duyệt HĐ). */
  requests: readonly TaskItem[];
  /** Mọi việc của `/me/review-tasks` theo id task — để dòng duyệt HĐ thuộc một lượt cũng nói «điều đang duyệt». */
  itemByTask?: ReadonlyMap<string, TaskItem>;
  signTag: string;
  now: number;
};

export function inboxRows(x: InboxInput): InboxRow[] {
  const runByTask = new Map([...(x.itemByTask ?? [])].map(([k, v]) => [k, v.process_run.id]));
  const approvals = x.approvals.map((a): InboxRow => {
    const item = x.itemByTask?.get(a.task_id);
    const title = approvalTitle(a);
    return {
      kind: "approval",
      key: `a:${a.task_id}`,
      tag: a.stage_name,
      summary: item ? requestSummaryLine(item) : (title ?? ""),
      due: a.due_at ? { at: a.due_at, late: Date.parse(a.due_at) < x.now } : null,
      escalated: a.escalated,
      since: item?.task.created_at ?? null,
      to: approvalTarget({ taskId: a.task_id, contractId: a.contract_id }, runByTask),
      // «Thay A»: `/my-work` đã mang `delegated_from` (cùng câu SQL duyệt) ⇒ không phụ thuộc `/me/review-tasks` tải kịp/trang đủ.
      ...claimFields({
        ...item?.task,
        ...(a.delegated_from ? { delegated_from: a.delegated_from } : {}),
      }),
    };
  });
  const sign = x.signing.map(
    (s): InboxRow => ({
      kind: "sign",
      key: `s:${s.contract_id}`,
      tag: x.signTag,
      summary: joinParts([approvalTitle(s), fmtDate(s.since)]),
      due: null,
      escalated: false,
      since: s.since,
      to: { to: "/contracts/c/$id", params: { id: s.contract_id } },
    }),
  );
  const req = x.requests.map(
    (i): InboxRow => ({
      kind: i.task.kind === "milestone" ? "milestone" : "request",
      key: `r:${i.task.id}`,
      tag: i.task.stage_name,
      summary: requestSummaryLine(i),
      due: null,
      escalated: i.task.escalated === true,
      since: i.task.created_at,
      to: { to: "/contracts/requests/$runId", params: { runId: i.process_run.id } },
      runId: i.process_run.id,
      ...claimFields(i.task),
    }),
  );
  const inbox = (x.inbox ?? []).map(
    (d): InboxRow => ({
      kind: "inbox",
      key: `i:${d.contract_id}`,
      tag: "", // nhãn «Đối tác gửi» do component dịch
      summary: joinParts([d.sender_name, d.contract_title ?? d.contract_number, fmtDate(d.since)]),
      due: null,
      escalated: false,
      since: d.since,
      to: { to: "/contracts/c/$id", params: { id: d.contract_id } },
      inbox: { contractId: d.contract_id, sender: d.sender_name },
    }),
  );
  return sortInbox([...approvals, ...sign, ...inbox, ...req]);
}

/** Có hạn ⇒ hạn gần trước; không hạn ⇒ sau, chờ lâu nhất trước (ổn định theo thứ tự vào). */
export function sortInbox(rows: readonly InboxRow[]): InboxRow[] {
  const t = (s: string | null) => (s ? Date.parse(s) : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => {
    if (a.due && b.due) return t(a.due.at) - t(b.due.at);
    if (a.due || b.due) return a.due ? -1 : 1;
    return t(a.since) - t(b.since);
  });
}

/** Chip: «Cần ký» = việc ký; «Cần duyệt» = mọi việc còn lại (duyệt HĐ + yêu cầu). */
export function filterInbox(rows: readonly InboxRow[], f: InboxFilter): InboxRow[] {
  if (f === "all") return [...rows];
  return rows.filter((r) => (f === "sign" ? r.kind === "sign" : r.kind !== "sign"));
}
