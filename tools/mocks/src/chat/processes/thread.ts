// HUB-FR-113 · U1 · câu tóm tắt `content` của tin `process` (≤ ROOM_PROCESS_CONTENT_MAX, locale vi) — mock, không phải
// `core/thread.rules.ts` thật của Hub; FE dựng hiển thị từ `process`.
import { ROOM_PROCESS_CONTENT_MAX, type RoomProcessPart } from "@ai/contracts/chat";

function text(p: RoomProcessPart, name: string): string {
  switch (p.kind) {
    case "block":
      return `▶ Quy trình ${name}`;
    case "output":
      return `${p.stage_name}: kết quả v${p.output.version}`;
    case "ask":
      return `${p.stage_name} hỏi: ${p.question}`;
    case "decision":
      return `Cần người quyết (${p.reason})`;
    case "task_result":
      return `${p.actor.display_name}: ${p.result}`;
    case "forward":
      return `${p.from.display_name} nhờ ${p.to.display_name}`;
    case "run_end":
      return `Quy trình ${name} kết thúc: ${p.status}`;
    case "branch": // P-d2 · PD2-R13
      return `Rẽ nhánh sang bước ${p.to_step + 1}`;
  }
}

export function threadContent(p: RoomProcessPart, processName: string): string {
  return text(p, processName).slice(0, ROOM_PROCESS_CONTENT_MAX);
}
