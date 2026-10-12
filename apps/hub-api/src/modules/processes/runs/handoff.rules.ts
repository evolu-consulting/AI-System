// HUB-FR-136 · R10/R11 · AC-PB2-09 · plan §4.1: khối "Bàn giao từ bước trước:" của prompt stage. Thuần: mỗi stage bước
// trước có mục `## Bàn giao` ⇒ `### <tên stage> (<file>)` + nội dung đã cắt (`clipHandoff`, 200 token ≈ 800 ký tự + "…").

import { clipHandoff, HANDOFF_SECTION } from "@ai/contracts/hub-admin";
import { normSection, sectionMap } from "./template.rules";

export type HandoffItem = { name: string; file: string; handoff: string | null };

export const HANDOFF_HEAD = "Bàn giao từ bước trước:";

/** null khi không stage nào có Bàn giao (không rỗng) ⇒ prompt như cũ (chỉ file đính kèm). */
export function handoffBlock(items: readonly HandoffItem[]): string | null {
  const parts = items.flatMap((i) => {
    const h = i.handoff?.trim() ?? "";
    return h.length > 0 ? [`### ${i.name} (${i.file})\n${clipHandoff(h).text}`] : [];
  });
  return parts.length > 0 ? `${HANDOFF_HEAD}\n\n${parts.join("\n\n")}` : null;
}

/** Thân mục `## Bàn giao` của output (đọc từ `process_outputs.content`, KHÔNG cột `sections` — HO-07); vắng/rỗng ⇒ null. */
export function handoffOf(content: string): string | null {
  const h = sectionMap(content).get(normSection(HANDOFF_SECTION));
  return h && h.length > 0 ? h : null;
}

/** `OutputRef.handoff_truncated`: Bàn giao vượt 200 token (≈ 800 ký tự) ⇒ bị cắt khi chuyển bước sau. */
export const handoffTruncated = (content: string): boolean => {
  const h = handoffOf(content);
  return h !== null && clipHandoff(h).truncated;
};

/** Hỏi–đáp đã đóng của lần làm hiện tại (≤ 3) — nối cuối prompt khi tiếp sau trả lời mà KHÔNG resume (plan §4.2). */
export function askHistoryBlock(
  qa: readonly { question: string; answer: string }[],
): string | null {
  if (qa.length === 0) return null;
  return qa.map((x) => `Câu hỏi trước:\n${x.question}\nTrả lời:\n${x.answer}`).join("\n\n");
}
