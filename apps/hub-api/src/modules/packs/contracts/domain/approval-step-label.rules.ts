// CR-123 · u10 · cột "Bước" của danh sách HĐ: bước hiện tại bằng chữ nghiệp vụ, suy từ CHÍNH dòng thời gian của thẻ duyệt
// (`stepsView`, Ký số đã gộp một bước ở u6) — không đọc nguồn thứ hai. Luật thuần, domain chỉ dùng kiểu cấu trúc.
// "Chờ <tên bước>" (bước duyệt/chờ đang mở) · "Chờ <người ký> ký" (Ký số đang chờ) · "Chờ gửi duyệt" (bước soạn) ·
// "Bị trả lại" (có bước bị trả về soạn lại) · "Đã duyệt" · "Bị từ chối" · "Cần xử lý" · null (không có gì để nói ⇒ giữ nhãn trạng thái).

/** Khớp cấu trúc `PackStepsView` (chỉ trường dùng). */
export type StepLabelView = {
  status: string;
  steps: readonly {
    idx: number;
    name: string;
    status: string;
    module?: { outcome: string; signer?: string } | undefined;
  }[];
};

const OPEN = new Set(["open", "running"]);

export function stepLabelOf(v: StepLabelView | null | undefined): string | null {
  if (!v) return null;
  if (v.status === "done")
    return v.steps.some((s) => s.status === "rejected") ? "Bị từ chối" : "Đã duyệt";
  if (v.status === "cancelled" || v.status === "expired") return "Đã huỷ";
  if (v.status === "failed" || v.status === "needs_decision") return "Cần xử lý";
  const cur = v.steps.find((s) => OPEN.has(s.status) || s.module?.outcome === "waiting");
  if (!cur) return null;
  if (cur.module) {
    const who = cur.module.signer?.trim();
    return who ? `Chờ ${who} ký` : "Chờ ký";
  }
  // bước soạn (đầu) đang mở sau khi bị trả lại ⇒ nói rõ "Bị trả lại", chưa trả lại ⇒ "Chờ gửi duyệt"
  if (cur.idx === 0)
    return v.steps.some((s) => s.status === "returned") ? "Bị trả lại" : "Chờ gửi duyệt";
  return `Chờ ${cur.name}`;
}
