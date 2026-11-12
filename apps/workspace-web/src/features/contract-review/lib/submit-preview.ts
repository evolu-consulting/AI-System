// CR-127 · M4 · «Khi gửi, hợp đồng sẽ đi qua: 1. Duyệt · Phòng Pháp chế · 48 giờ → 2. …». Luật thuần: bước máy chủ trả ⇒ chuỗi gọn.
import type { SubmitPreviewResponse, SubmitPreviewStep } from "@ai/contracts/pack-contracts";

export type PreviewLine = { n: number; text: string };

/** «Nhãn · ai làm · N giờ» (bỏ phần trống). */
export function stepText(s: SubmitPreviewStep, hours: (n: number) => string): string {
  return [s.label, s.who_label, s.due_h ? hours(s.due_h) : ""].filter((x) => x !== "").join(" · ");
}

/** Danh sách đánh số; `block` (chưa có quy trình — dòng lý do NF1 đã nói) hoặc không có bước ⇒ rỗng (không hiện khối). */
export function previewLines(
  r: SubmitPreviewResponse | undefined,
  hours: (n: number) => string,
): PreviewLine[] {
  if (!r || r.block || r.steps.length === 0) return [];
  return r.steps.map((s, i) => ({ n: i + 1, text: stepText(s, hours) }));
}
