// CR-103 · fnr-fix-unfreeze · luật thuần: cảnh báo trên giai đoạn khi Hub ở chế độ route chỉ quản trị (`HUB_PROCESS_ROUTES=admin`).
// Ở chế độ này member không có hộp việc (route `/review-tasks/*` sau cổng admin) và route trả lời câu hỏi không mount ⇒
// giai đoạn "Duyệt bởi Group" chỉ admin thuộc Group duyệt được; câu hỏi AI không ai trả lời được (lượt chạy chờ).

export type AdminModeWarning = "review" | "ask";

/** `gate` = giai đoạn có phần "Sau giai đoạn" (không phải Áp); `asks` = giai đoạn có "Người trả lời" (không phải tool/set). */
export function adminModeWarnings(
  adminOnly: boolean,
  s: { after: string; gate: boolean; asks: boolean },
): AdminModeWarning[] {
  if (!adminOnly) return [];
  const out: AdminModeWarning[] = [];
  if (s.gate && s.after === "review") out.push("review");
  if (s.asks) out.push("ask");
  return out;
}
