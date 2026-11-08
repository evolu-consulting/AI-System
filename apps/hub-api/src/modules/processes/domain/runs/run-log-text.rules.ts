// CR-121 · R-2 · câu chữ dễ hiểu (vi + en) cho trang chi tiết lượt chạy: mã lỗi → câu, trạng thái run/bước, nguồn kích hoạt,
// kết quả duyệt; quyết định MỨC nhật ký theo vai (không theo tham số client). Thuần, lớp 1 (không I/O).
import type { RunStepState } from "@ai/contracts/chat";

export type I18n = { vi: string; en: string };
export type LogLevel = "basic" | "debug";

/** Mức nhật ký: chỉ platform_admin thấy debug; mọi vai khác (tenant admin…) chỉ basic — KHÔNG đọc tham số client. */
export const logLevelOf = (role: string): LogLevel =>
  role === "platform_admin" ? "debug" : "basic";
/** Vai được xem trang chi tiết lượt chạy (admin). */
export const canViewRunDetail = (role: string): boolean =>
  role === "platform_admin" || role === "tenant_admin";

const retrying = (n: string): I18n => ({
  vi: `Bước ${n} chưa chạy được, hệ thống đang thử lại.`,
  en: `Step ${n} could not run yet; the system is retrying.`,
});
const TIMEOUT = (n: string): I18n => ({
  vi: `Bước ${n} chạy quá thời gian cho phép. Hệ thống sẽ thử lại; nếu vẫn lỗi, hãy chọn chạy thêm một lượt hoặc huỷ.`,
  en: `Step ${n} took too long. The system will retry; if it keeps failing, add another attempt or cancel.`,
});
const NEEDS_PERSON = (vi: string, en: string) => (_n: string) => ({ vi, en });

/** Mã (không phân biệt hoa/thường) → câu. Gồm mã lỗi job/lý do job (`error_reason`) và `decision.reason` của run. */
const ERROR_TEXT: Readonly<Record<string, (stageName: string) => I18n>> = {
  timeout: TIMEOUT,
  job_timeout: TIMEOUT,
  upstream: retrying,
  upstream_error: retrying,
  crash: retrying,
  orphaned: retrying,
  interrupted: retrying,
  provider_busy: (n) => ({
    vi: `Bước ${n} đang chờ tới lượt vì hệ thống AI đang bận, sẽ tự chạy lại.`,
    en: `Step ${n} is waiting its turn because the AI service is busy; it will retry on its own.`,
  }),
  tenant_slots: (n) => ({
    vi: `Bước ${n} đang chờ vì công ty đã dùng hết số lượt chạy cùng lúc, sẽ tự chạy khi có chỗ trống.`,
    en: `Step ${n} is waiting because your company reached its concurrent limit; it will run when a slot frees up.`,
  }),
  retry_exhausted: (n) => ({
    vi: `Bước ${n} đã thử lại nhiều lần vẫn lỗi. Hãy chọn chạy thêm một lượt hoặc huỷ lượt chạy.`,
    en: `Step ${n} failed after several retries. Add another attempt or cancel the run.`,
  }),
  agent_failed: (n) => ({
    vi: `Trợ lý ở bước ${n} gặp lỗi khi xử lý. Hãy chọn chạy thêm một lượt, dùng kết quả hiện có hoặc huỷ.`,
    en: `The agent at step ${n} failed. Add another attempt, use the current result, or cancel.`,
  }),
  tool_failed: (n) => ({
    vi: `Công cụ ở bước ${n} gặp lỗi. Hãy kiểm tra kết nối rồi chạy thêm một lượt.`,
    en: `The tool at step ${n} failed. Check the connection, then add another attempt.`,
  }),
  redo_limit: NEEDS_PERSON(
    "Đã làm lại quá số lần cho phép. Cần người quyết định bước tiếp theo.",
    "The redo limit was reached. Someone needs to decide what happens next.",
  ),
  ask_limit: NEEDS_PERSON(
    "Trợ lý đã hỏi quá số lần cho phép. Cần người quyết định bước tiếp theo.",
    "The agent asked too many questions. Someone needs to decide what happens next.",
  ),
  back_limit: NEEDS_PERSON(
    "Đã quay lại bước trước quá số lần cho phép. Cần người quyết định.",
    "The limit for going back was reached. Someone needs to decide.",
  ),
  template_invalid: (n) => ({
    vi: `Kết quả của bước ${n} chưa đúng mẫu yêu cầu. Cần người quyết định.`,
    en: `The result of step ${n} does not match the required template. Someone needs to decide.`,
  }),
  stage_tokens: (n) => ({
    vi: `Bước ${n} đã dùng hết hạn mức xử lý. Cần người quyết định.`,
    en: `Step ${n} used up its processing budget. Someone needs to decide.`,
  }),
  run_tokens: NEEDS_PERSON(
    "Lượt chạy đã dùng hết hạn mức xử lý. Cần người quyết định.",
    "The run used up its processing budget. Someone needs to decide.",
  ),
  team_calls: NEEDS_PERSON(
    "Nhóm trợ lý đã đạt giới hạn số lần gọi. Cần người quyết định.",
    "The agent team reached its call limit. Someone needs to decide.",
  ),
  team_tokens: NEEDS_PERSON(
    "Nhóm trợ lý đã dùng hết hạn mức xử lý. Cần người quyết định.",
    "The agent team used up its budget. Someone needs to decide.",
  ),
  team_time: NEEDS_PERSON(
    "Nhóm trợ lý đã chạy quá thời gian cho phép. Cần người quyết định.",
    "The agent team ran past its time limit. Someone needs to decide.",
  ),
  team_no_change: NEEDS_PERSON(
    "Nhóm trợ lý không còn tạo thêm thay đổi. Cần người quyết định.",
    "The agent team stopped making progress. Someone needs to decide.",
  ),
  permission_lost: NEEDS_PERSON(
    "Người bắt đầu không còn quyền chạy quy trình này. Hãy cấp lại quyền hoặc huỷ lượt chạy.",
    "The person who started this run no longer has permission. Restore access or cancel the run.",
  ),
  user_inactive: NEEDS_PERSON(
    "Tài khoản của người bắt đầu đã bị khoá. Hãy mở khoá hoặc huỷ lượt chạy.",
    "The starter's account is disabled. Re-enable it or cancel the run.",
  ),
  source_unresolvable: NEEDS_PERSON(
    "Không đọc được nguồn dữ liệu của bước. Hãy kiểm tra kết nối nguồn rồi chạy lại.",
    "The step's data source could not be read. Check the source connection and run again.",
  ),
  timer_invalid: NEEDS_PERSON(
    "Ngày giờ hẹn của bước không hợp lệ. Cần người quyết định.",
    "The scheduled date or time is invalid. Someone needs to decide.",
  ),
  autofix_check_failed: NEEDS_PERSON(
    "Bản sửa tự động chưa qua bước kiểm tra. Cần người quyết định.",
    "The automatic fix did not pass its checks. Someone needs to decide.",
  ),
  sandbox_unavailable: NEEDS_PERSON(
    "Môi trường chạy thử chưa sẵn sàng. Hãy thử lại sau ít phút.",
    "The test environment is not ready. Try again in a few minutes.",
  ),
  apply_conflict: NEEDS_PERSON(
    "Bản sửa bị xung đột với thay đổi mới. Cần người quyết định.",
    "The fix conflicts with newer changes. Someone needs to decide.",
  ),
  apply_failed: NEEDS_PERSON(
    "Không áp được bản sửa. Cần người quyết định.",
    "The fix could not be applied. Someone needs to decide.",
  ),
};

/** Mã lỗi/lý do → câu dễ hiểu; mã lạ/vắng ⇒ "Bước … chưa chạy được, hệ thống đang thử lại". Không bao giờ lộ mã. */
export function friendlyError(code: string | null | undefined, stageName: string): I18n {
  const f = code ? ERROR_TEXT[code.toLowerCase()] : undefined;
  return (f ?? retrying)(stageName);
}

/** CR-125 G2 · MỘT nhãn chờ duyệt (động từ "Duyệt") cho trạng thái run, ghi chú bước và dòng thời gian. */
export const WAITING_REVIEW_TEXT: I18n = {
  vi: "Đang chờ người duyệt",
  en: "Waiting for a reviewer",
};

const STATUS_TEXT: Readonly<Record<string, I18n>> = {
  running: { vi: "Đang chạy", en: "Running" },
  waiting_review: WAITING_REVIEW_TEXT,
  waiting_answer: { vi: "Đang chờ người trả lời", en: "Waiting for an answer" },
  waiting_timer: { vi: "Đang chờ tới giờ hẹn", en: "Waiting for the scheduled time" },
  needs_decision: { vi: "Cần người quyết định", en: "Needs a decision" },
  done: { vi: "Đã hoàn thành", en: "Completed" },
  cancelled: { vi: "Đã huỷ", en: "Cancelled" },
  failed: { vi: "Thất bại", en: "Failed" },
  expired: { vi: "Đã hết hạn", en: "Expired" },
};

/** Trạng thái run + lý do (vì sao dừng / đang chờ ai / bước kế). */
export function runStatusText(r: {
  status: string;
  decisionReason: string | null;
  currentStageName: string | null;
}): I18n {
  const base = STATUS_TEXT[r.status] ?? { vi: r.status, en: r.status };
  const stage = r.currentStageName;
  if (r.status === "needs_decision" && r.decisionReason) {
    const why = friendlyError(r.decisionReason, stage ?? "");
    return { vi: `${base.vi}. ${why.vi}`, en: `${base.en}. ${why.en}` };
  }
  if (!stage || r.status === "done" || r.status === "cancelled" || r.status === "expired")
    return base;
  return { vi: `${base.vi} — bước "${stage}"`, en: `${base.en} — step "${stage}"` };
}

const ORIGIN_LABEL: Readonly<Record<string, I18n>> = {
  room: { vi: "Từ phòng chat", en: "From a chat room" },
  conversation: { vi: "Từ cuộc trò chuyện", en: "From a conversation" },
  admin: { vi: "Do quản trị viên chạy", en: "Started by an admin" },
};
export const originLabel = (kind: string): I18n =>
  ORIGIN_LABEL[kind] ?? { vi: "Không rõ nguồn", en: "Unknown source" };

const EXECUTOR_LABEL: Readonly<Record<string, I18n>> = {
  agent: { vi: "Trợ lý", en: "Agent" },
  team: { vi: "Nhóm trợ lý", en: "Agent team" },
  apply: { vi: "Áp bản sửa", en: "Apply the fix" },
  wait_until: { vi: "Chờ tới ngày", en: "Wait until date" },
  wait_for: { vi: "Chờ N giờ", en: "Wait for hours" },
  wait_event: { vi: "Chờ sự kiện", en: "Wait for event" },
  tool: { vi: "Công cụ", en: "Tool" },
  set: { vi: "Ghi giá trị", en: "Set values" },
  form: { vi: "Người điền form", en: "Fill in a form" },
  if: { vi: "Kiểm tra điều kiện", en: "Check a condition" },
};
/** Tên hiển thị của executor: tên catalog (agent/nhóm) nếu có, ngược lại nhãn theo loại. */
export function executorName(kind: string, vi: string | null, en: string | null): I18n {
  const fb = EXECUTOR_LABEL[kind] ?? { vi: kind, en: kind };
  return { vi: vi || fb.vi, en: en || vi || fb.en };
}

/** Trạng thái engine của stage → trạng thái nghiệp vụ. `cancelled` chưa từng chạy ⇒ "chưa tới". */
export function stepStateOf(raw: string, startedAt: string | null): RunStepState {
  switch (raw) {
    case "done":
      return "done";
    case "skipped":
      return "skipped";
    case "failed":
      return "error";
    case "needs_decision":
      return "needs_decision";
    case "cancelled":
      return startedAt ? "cancelled" : "not_reached";
    case "pending":
      return "not_reached";
    default:
      return "running"; // queued · running · waiting_answer · waiting_review · waiting_timer
  }
}

const WAIT_NOTE: Readonly<Record<string, I18n>> = {
  waiting_review: WAITING_REVIEW_TEXT,
  waiting_answer: { vi: "Đang chờ người trả lời câu hỏi.", en: "Waiting for someone to answer." },
  waiting_timer: { vi: "Đang chờ tới giờ hẹn.", en: "Waiting for the scheduled time." },
  queued: { vi: "Đang xếp hàng chờ chạy.", en: "Queued to run." },
};

/** Ghi chú dễ hiểu cho bước (lỗi/chờ/bỏ qua); bước bình thường ⇒ undefined. */
export function stepNote(s: {
  raw: string;
  name: string;
  lastErrorCode: string | null;
  retryCount: number;
}): I18n | undefined {
  if (s.raw === "skipped")
    return {
      vi: "Bước này bị bỏ qua do một luật rẽ nhánh ở bước trước.",
      en: "Skipped because a branch rule at an earlier step sent the run elsewhere.",
    };
  if (s.raw === "needs_decision" || s.raw === "failed")
    return friendlyError(s.lastErrorCode, s.name);
  if (s.retryCount > 0 || (s.raw === "waiting_timer" && s.lastErrorCode))
    return friendlyError(s.lastErrorCode, s.name);
  return WAIT_NOTE[s.raw];
}

/** Lý do dừng/chạy lại của admin (`RUN_CONTROL_REASONS`); mã lạ/vắng ⇒ null. */
const CONTROL_REASON: Readonly<Record<string, I18n>> = {
  sent_by_mistake: { vi: "gửi nhầm", en: "sent by mistake" },
  needs_edit: { vi: "cần chỉnh sửa", en: "needs editing" },
  bad_data: { vi: "dữ liệu sai", en: "bad data" },
  other: { vi: "lý do khác", en: "other reason" },
};
export const controlReasonText = (reason: string | null): I18n | null =>
  reason ? (CONTROL_REASON[reason] ?? null) : null;

const RESULT_TEXT: Readonly<Record<string, I18n>> = {
  pass: { vi: "Đã duyệt — đạt", en: "Approved" },
  fail: { vi: "Chưa đạt — cần làm lại", en: "Not approved — needs rework" },
  reject: { vi: "Từ chối — kết thúc lượt chạy", en: "Rejected — the run ends" },
  answer: { vi: "Đã trả lời", en: "Answered" },
  add_attempt: { vi: "Chọn chạy thêm một lượt", en: "Chose to add another attempt" },
  use_current: { vi: "Chọn dùng kết quả hiện có", en: "Chose to use the current result" },
  cancel: { vi: "Chọn huỷ lượt chạy", en: "Chose to cancel the run" },
  cancelled: { vi: "Việc bị huỷ vì lượt chạy đã huỷ", en: "Closed because the run was cancelled" },
  expired: { vi: "Hết hạn không ai xử lý", en: "Expired without being handled" },
  superseded: { vi: "Được thay bằng việc mới hơn", en: "Replaced by a newer task" },
};
export const resultText = (result: string | null): I18n | null =>
  result ? (RESULT_TEXT[result] ?? null) : null;
