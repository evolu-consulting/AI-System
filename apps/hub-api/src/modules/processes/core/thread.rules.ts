// HUB-FR-113 · U1 · câu tóm tắt tin thread `process` (plan-thread §2): preview danh sách phòng + dự phòng khi FE không dựng
// được `process`. Thuần. 1..500 ký tự; `forward` KHÔNG chép ghi chú (chỉ người nhận đọc qua task).
import { ROOM_PROCESS_CONTENT_MAX, type RoomProcessPart } from "@ai/contracts/chat";

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

const t = (l: ThreadLocale, vi: string, en: string): string => (l === "vi" ? vi : en);

function resultLine(e: Part<"task_result">, l: ThreadLocale): string {
  const label = RESULT[e.result]?.[l] ?? e.result;
  const text = e.feedback ?? e.answer ?? e.choice;
  return `${e.actor.display_name}: ${label}${text ? ` — ${text}` : ""}`;
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
    case "decision":
      return t(
        l,
        `${n.process}: cần quyết định (${e.reason})`,
        `${n.process}: decision needed (${e.reason})`,
      );
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
