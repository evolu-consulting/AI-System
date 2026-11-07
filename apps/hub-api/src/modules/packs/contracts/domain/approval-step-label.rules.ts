// CR-123 · u10 · cột "Bước" của danh sách HĐ: bước hiện tại bằng chữ nghiệp vụ, suy từ CHÍNH dòng thời gian của thẻ duyệt
// (`stepsView`, Ký số đã gộp một bước ở u6) — không đọc nguồn thứ hai. Luật thuần, domain chỉ dùng kiểu cấu trúc.
// "Chờ <tên bước>" (bước duyệt/chờ đang mở) · "Chờ <người ký> ký" (Ký số đang chờ) · "Chờ gửi duyệt" (bước soạn) ·
// "Trả lại — chờ sửa" (có bước bị trả về soạn lại) · "Đã duyệt" · "Từ chối" · "Đã huỷ" · "Cần xử lý" · null (không có gì để nói ⇒ giữ nhãn trạng thái).

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

/** `fromRun` = thẻ dựng bước từ run (event flow; `from_run` của thẻ): bước đầu là bước duyệt thật ⇒ "Chờ <tên bước>", không phải bước soạn. */
export function stepLabelOf(v: StepLabelView | null | undefined, fromRun = false): string | null {
  if (!v) return null;
  // kết cục cuối của lượt (một nguồn cho danh sách HĐ): bước bị từ chối là chứng cứ chắc nhất ⇒ thắng cả "huỷ" / "xong"
  if (v.steps.some((s) => s.status === "rejected")) return "Từ chối";
  if (v.status === "done") return "Đã duyệt";
  if (v.status === "cancelled" || v.status === "expired") return "Đã huỷ";
  if (v.status === "failed" || v.status === "needs_decision") return "Cần xử lý";
  const cur = v.steps.find((s) => OPEN.has(s.status) || s.module?.outcome === "waiting");
  if (!cur) return null;
  if (cur.module) {
    const who = cur.module.signer?.trim();
    return who ? `Chờ ${who} ký` : "Chờ ký";
  }
  // bước soạn (đầu) đang mở sau khi bị trả lại ⇒ nói rõ "Bị trả lại", chưa trả lại ⇒ "Chờ gửi duyệt"
  if (cur.idx === 0 && !fromRun) return draftLabel(v);
  return `Chờ ${cur.name}`;
}

const draftLabel = (v: StepLabelView): string =>
  v.steps.some((s) => s.status === "returned") ? "Trả lại — chờ sửa" : "Chờ gửi duyệt";
