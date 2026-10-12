// HUB-FR-113 · U1 · câu tóm tắt tin thread `process` (plan-thread §2): preview danh sách phòng + dự phòng khi FE không dựng
// được `process`. Thuần. 1..500 ký tự; `forward` KHÔNG chép ghi chú (chỉ người nhận đọc qua task).
import {
  type DecisionReason,
  ROOM_PROCESS_CONTENT_MAX,
  type RoomProcessPart,
} from "@ai/contracts/chat";

export type ThreadLocale = "vi" | "en";
type Names = { process: string; stage?: string };
type Part<K extends RoomProcessPart["kind"]> = Extract<RoomProcessPart, { kind: K }>;

const RESULT: Record<string, { vi: string; en: string }> = {
  pass: { vi: "Đạt", en: "Approved" },
  fail: { vi: "Chưa đạt", en: "Changes requested" },
  answer: { vi: "Đã trả lời", en: "Answered" },
  add_attempt: { vi: "Cho chạy thêm", en: "Added an attempt" },
  use_current: { vi: "Dùng bản hiện tại", en: "Used current output" },
  cancel: { vi: "Huỷ quy trình", en: "Cancelled the process" },
};
const END: Record<Part<"run_end">["status"], { vi: string; en: string }> = {
  done: { vi: "hoàn tất", en: "completed" },
  cancelled: { vi: "đã huỷ", en: "cancelled" },
  failed: { vi: "lỗi", en: "failed" },
  expired: { vi: "hết hạn", en: "expired" },
};
// D6b · lý do quyết định hiển thị bằng câu thân thiện (khớp `process.common.<reason>` của FE), không lộ mã thô
// như `template_invalid`. Ngắn gọn cho preview flow/timeline; phủ mọi `DECISION_REASONS`.
const REASON: Record<DecisionReason, { vi: string; en: string }> = {
  redo_limit: { vi: "đã làm lại quá số lần", en: "redo limit reached" },
  ask_limit: { vi: "đã hỏi quá số lần", en: "ask limit reached" },
  template_invalid: { vi: "kết quả chưa đủ mục theo mẫu", en: "output missing required sections" },
  team_calls: { vi: "nhóm hết lượt gọi", en: "team call limit reached" },
  team_tokens: { vi: "nhóm hết ngân sách token", en: "team token budget reached" },
  team_time: { vi: "nhóm chạy quá thời gian", en: "team time limit reached" },
  team_no_change: { vi: "nhóm không cải thiện thêm", en: "team made no further progress" },
  job_timeout: { vi: "giai đoạn chạy quá thời gian", en: "stage timed out" },
  stage_tokens: { vi: "giai đoạn vượt ngân sách token", en: "stage token budget reached" },
  run_tokens: { vi: "lượt chạy vượt ngân sách token", en: "run token budget reached" },
  agent_failed: { vi: "agent báo lỗi", en: "agent failed" },
  permission_lost: { vi: "người bắt đầu mất quyền", en: "starter lost permission" },
  user_inactive: { vi: "người bắt đầu bị khoá", en: "starter account inactive" },
  interrupted: { vi: "giai đoạn bị gián đoạn", en: "stage interrupted" },
  source_unresolvable: {
    vi: "không lấy được nguồn tham chiếu",
    en: "source could not be resolved",
  },
  back_limit: { vi: "đã quay lại quá số vòng", en: "go-back limit reached" },
};

const t = (l: ThreadLocale, vi: string, en: string): string => (l === "vi" ? vi : en);

function resultLine(e: Part<"task_result">, l: ThreadLocale): string {
  const label = RESULT[e.result]?.[l] ?? e.result;
  const text = e.feedback ?? e.answer ?? e.choice;
  // P-b2 · quay lại bước (HUB-FR-118): bước hiển thị 1-based như StageStrip.
  const back =
    e.to_step === undefined
      ? ""
      : t(l, ` · quay lại bước ${e.to_step + 1}`, ` · back to step ${e.to_step + 1}`);
  return `${e.actor.display_name}: ${label}${back}${text ? ` — ${text}` : ""}`;
}

function line(e: RoomProcessPart, l: ThreadLocale, n: Names): string {
  switch (e.kind) {
    case "block":
      return t(
        l,
        `${n.process} · bắt đầu (${e.stage_count} bước)`,
        `${n.process} · started (${e.stage_count} stages)`,
      );
    case "output": {
      const v = e.output.version;
      return t(
        l,
        `${e.stage_name}: có kết quả (bản ${v})`,
        `${e.stage_name}: output ready (v${v})`,
      );
    }
    case "ask":
      return t(
        l,
        `${e.stage_name}: cần trả lời — ${e.question}`,
        `${e.stage_name}: needs an answer — ${e.question}`,
      );
    case "decision": {
      const r = REASON[e.reason] ?? { vi: e.reason, en: e.reason };
      return t(
        l,
        `${n.process}: cần quyết định — ${r.vi}`,
        `${n.process}: decision needed — ${r.en}`,
      );
    }
    case "task_result":
      return resultLine(e, l);
    case "forward":
      return t(
        l,
        `${e.from.display_name} nhờ ${e.to.display_name}`,
        `${e.from.display_name} asked ${e.to.display_name}`,
      );
    case "run_end":
      return `${n.process} · ${END[e.status][l]}`;
  }
}

/** ≤ 500 đơn vị UTF-16, không cắt đôi cặp surrogate; rỗng ⇒ tên quy trình. */
export function threadContent(e: RoomProcessPart, locale: ThreadLocale, names: Names): string {
  const s = line(e, locale, names).trim() || names.process || "…";
  if (s.length <= ROOM_PROCESS_CONTENT_MAX) return s;
  const cut = s.slice(0, ROOM_PROCESS_CONTENT_MAX - 1);
  return `${/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut}…`;
}
