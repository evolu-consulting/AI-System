// CR-123 · u10 · cột "Bước" của danh sách HĐ: bước hiện tại suy từ CHÍNH dòng thời gian của thẻ duyệt
// (`stepsView`, Ký số đã gộp một bước ở u6) — không đọc nguồn thứ hai. Luật thuần, domain chỉ dùng kiểu cấu trúc.
// CR-125 · SA H4 · máy chủ trả MÃ (không trả chữ tiếng Việt): web dịch qua i18n (`contracts.list.step.<code>`) và so sánh theo mã.
// waiting_step (+name) · waiting_sign (+who) · waiting_draft · returned · approved · rejected · cancelled · attention · null (giữ nhãn trạng thái).

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

export type StepCode =
  | "rejected"
  | "approved"
  | "cancelled"
  | "attention"
  | "waiting_sign"
  | "waiting_draft"
  | "returned"
  | "waiting_step";
/** `who` = tên người ký (waiting_sign), `name` = tên bước (waiting_step): dữ liệu của khách, không phải nhãn. */
export type StepState = { code: StepCode; who?: string; name?: string };

const OPEN = new Set(["open", "running"]);

/** `fromRun` = thẻ dựng bước từ run (event flow; `from_run` của thẻ): bước đầu là bước duyệt thật ⇒ waiting_step, không phải bước soạn. */
export function stepLabelOf(
  v: StepLabelView | null | undefined,
  fromRun = false,
): StepState | null {
  if (!v) return null;
  // kết cục cuối của lượt (một nguồn cho danh sách HĐ): bước bị từ chối là chứng cứ chắc nhất ⇒ thắng cả "huỷ" / "xong"
  if (v.steps.some((s) => s.status === "rejected")) return { code: "rejected" };
  if (v.status === "done") return { code: "approved" };
  if (v.status === "cancelled" || v.status === "expired") return { code: "cancelled" };
  if (v.status === "failed" || v.status === "needs_decision") return { code: "attention" };
  const cur = v.steps.find((s) => OPEN.has(s.status) || s.module?.outcome === "waiting");
  if (!cur) return null;
  if (cur.module) {
    const who = cur.module.signer?.trim();
    return who ? { code: "waiting_sign", who } : { code: "waiting_sign" };
  }
  // bước soạn (đầu) đang mở sau khi bị trả lại ⇒ "returned", chưa trả lại ⇒ "waiting_draft"
  if (cur.idx === 0 && !fromRun) return draftState(v);
  return { code: "waiting_step", name: cur.name };
}

const draftState = (v: StepLabelView): StepState => ({
  code: v.steps.some((s) => s.status === "returned") ? "returned" : "waiting_draft",
});
