// CR-123 U2 (FLOW3-FR-13 · ux-audit 24-26) · mỗi bước của thẻ duyệt hiện đúng 3 dòng ngắn: TRẠNG THÁI · LÝ DO · BƯỚC KẾ (ai cần làm
// gì). Thuần, không React: trả khoá i18n + tham số; `fmt` định dạng ngày giờ để test không phụ thuộc múi giờ máy.
import { type ContractApproval, esignLabelKey } from "@ai/contracts/pack-contracts";
import { hoursLeft, type TimelineRow } from "./engine-card";

export type Line = { key: string; vars?: Record<string, string | number> };
export type StatusLines = { state: Line; reason: Line; next: Line };

type Ctx = {
  /** Người xem là người cần quyết bước đang mở (thẻ `can_act` + có quyền ghi). */
  canAct: boolean;
  now: number;
  /** ISO ⇒ chuỗi hiển thị (ngày giờ theo máy người xem). */
  fmt: (iso: string) => string;
};

const C = "contracts.approval.card";
const E = "contracts.approval.esign";

const feedbackLine = (text: string | null, none: string): Line =>
  text?.trim() ? { key: `${C}.reason.feedback`, vars: { text: text.trim() } } : { key: none };

function openReason(r: TimelineRow, c: Ctx): Line {
  if (!r.due) return { key: `${C}.reason.openNoDue` };
  const due = c.fmt(r.due.at);
  return r.overdue
    ? {
        key: `${C}.reason.openOverdue`,
        vars: { n: Math.max(1, Math.abs(hoursLeft(r.due.at, c.now))), due },
      }
    : { key: `${C}.reason.openDue`, vars: { due } };
}

function passedReason(r: TimelineRow, c: Ctx): Line {
  if (!r.decidedBy) return { key: `${C}.reason.passedAuto` };
  const at = r.decidedAt ? c.fmt(r.decidedAt) : "";
  return {
    key: `${C}.reason.${r.ownerOverride ? "passedOwner" : "passedBy"}`,
    vars: { name: r.decidedBy, at },
  };
}

/** Lý do máy chủ ghi khi đóng thẻ nhóm còn lại của bước «cùng duyệt» (`gates/parallel-approve.ts`) → khoá i18n; lạ ⇒ hiện nguyên câu. */
const CLOSED_REASON: Readonly<Record<string, string>> = {
  "Đã đủ người duyệt": "closedEnough",
  "Đã có người từ chối/trả lại": "closedDeclined",
};

function closedLines(text: string): StatusLines {
  const known = CLOSED_REASON[text];
  return {
    state: { key: `${C}.state.closed` },
    reason: known ? { key: `${C}.reason.${known}` } : feedbackLine(text, `${C}.reason.passedAuto`),
    next: { key: `${C}.next.closed` },
  };
}

/** Một bước duyệt / tự động / thông báo ⇒ 3 dòng. `who` = phòng duyệt, thiếu thì tên bước (không lộ id). */
export function rowStatusLines(r: TimelineRow, c: Ctx): StatusLines {
  const who = r.group || r.name;
  switch (r.status) {
    case "open":
      return {
        state: who ? { key: `${C}.state.open`, vars: { who } } : { key: `${C}.state.openAnon` },
        reason: openReason(r, c),
        next: c.canAct
          ? { key: `${C}.next.openMe` }
          : who
            ? { key: `${C}.next.openOther`, vars: { who } }
            : { key: `${C}.next.openOtherAnon` },
      };
    case "passed":
      // CR-125 · «cùng duyệt»: thẻ của nhóm KHÁC bị đóng (superseded) khi bước đã quyết xong ⇒ không phải «Đã duyệt» bởi họ: nói đóng + lý do
      if (!r.decidedBy && r.feedback?.trim()) return closedLines(r.feedback.trim());
      return {
        state: { key: `${C}.state.passed` },
        reason: passedReason(r, c),
        next: { key: `${C}.next.passed` },
      };
    case "skipped":
      return {
        state: { key: `${C}.state.skipped` },
        reason: { key: `${C}.reason.skipped` },
        next: { key: `${C}.next.skipped` },
      };
    case "returned":
      return {
        state: { key: `${C}.state.returned` },
        reason: feedbackLine(r.feedback, `${C}.reason.returnedNone`),
        next: { key: `${C}.next.returned` },
      };
    case "rejected":
      return {
        state: { key: `${C}.state.rejected` },
        reason: feedbackLine(r.feedback, `${C}.reason.rejectedNone`),
        next: { key: `${C}.next.rejected` },
      };
    case "running":
      return {
        state: { key: `${C}.state.running` },
        reason: { key: `${C}.reason.running` },
        next: { key: `${C}.next.running` },
      };
    case "failed":
      return {
        state: { key: `${C}.state.failed` },
        reason: { key: `${C}.reason.failed` },
        next: { key: `${C}.next.failed` },
      };
    default:
      return {
        state: { key: `${C}.state.pending` },
        reason: { key: `${C}.reason.pending` },
        next: who ? { key: `${C}.next.pending`, vars: { who } } : { key: `${C}.next.pendingAnon` },
      };
  }
}

type Esign = NonNullable<ContractApproval["esign"]>;

/** Bước Ký số ⇒ 3 dòng (lý do lỗi nói cách khắc phục; "Gửi lại" chỉ khi `can_resend`). */
export function esignStatusLines(e: Esign): StatusLines {
  const state = { key: esignLabelKey(e.status) }; // CR-125 c1 · cùng nhãn với khối Ký số (nguồn: phong bì)
  switch (e.status) {
    case "pending":
      return {
        state,
        reason: { key: `${E}.line.reason.pending` },
        next: { key: `${E}.line.next.pending` },
      };
    case "sending":
      return {
        state,
        reason: { key: `${E}.line.reason.sending` },
        next: { key: `${E}.line.next.sending` },
      };
    case "sent":
      return {
        state,
        // Hạn ký (nếu có) hiện ở dòng riêng `data-esign=due-at` ngay dưới ⇒ dòng lý do không lặp lại.
        reason: { key: `${E}.line.reason.${e.due_at ? "sent" : "sentNoDue"}` },
        next: { key: `${E}.line.next.sent` },
      };
    case "completed":
      return {
        state,
        reason: { key: `${E}.line.reason.completed` },
        next: { key: `${E}.line.next.completed` },
      };
    default:
      return {
        state,
        reason: e.reason ? { key: `${E}.reason.${e.reason}` } : { key: `${E}.reason.SEND_FAILED` },
        next: { key: `${E}.line.next.${e.can_resend ? "resend" : "owner"}` },
      };
  }
}

/** Tên các bước Thông báo không có người nhận (cảnh báo `NOTIFY_NO_RECIPIENT`) — chủ HĐ cần biết, không để im lặng. */
export const noRecipientSteps = (
  steps: readonly { name: string; warning?: string | null | undefined }[],
): string[] => steps.filter((s) => s.warning === "NOTIFY_NO_RECIPIENT").map((s) => s.name);
