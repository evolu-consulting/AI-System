// CR-101 DOC-model · R43–R46 · Câu 9: luật thuần loại chứng từ (HĐ kinh tế / HĐ nguyên tắc / giao dịch). Lớp 1 — không I/O.
// HĐ NT không có giá trị riêng (= Σ con), hạn mức tuỳ chọn; ngày con ngoài hiệu lực chỉ cảnh báo. `attachVerdict` ≡ trigger
// `contracts.doc_frame_check` (0055) để route trả lỗi sớm/đúng mã.

export const DOC_TYPES = ["contract", "framework", "deal"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type FrameStage = "not_started" | "active" | "expired";

/** Giai đoạn HĐ NT theo hiệu lực (ngày `YYYY-MM-DD`, so chuỗi); thiếu ngày ⇒ phía đó mở. */
export function frameStage(f: {
  start: string | null;
  end: string | null;
  today: string;
}): FrameStage {
  if (f.start !== null && f.today < f.start) return "not_started";
  if (f.end !== null && f.today > f.end) return "expired";
  return "active";
}

type ChildValue = { value: number | null; status: string };

/** Giá trị HĐ NT = Σ giá trị con (bỏ trống và con bị từ chối). */
export function frameValue(children: readonly ChildValue[]): number {
  let s = 0;
  for (const c of children) if (c.value !== null && c.status !== "rejected") s += c.value;
  return s;
}

/** % hạn mức đã dùng (một chữ số thập phân); không hạn mức hoặc hạn mức 0 ⇒ null. */
export function creditPct(total: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null;
  return Math.round((total * 1000) / limit) / 10;
}

export type FrameSummary = {
  stage: FrameStage;
  value: number;
  credit_pct: number | null;
  children: number;
};

export function frameSummary(
  f: { start: string | null; end: string | null; creditLimit: number | null },
  children: readonly ChildValue[],
  today: string,
): FrameSummary {
  const value = frameValue(children);
  return {
    stage: frameStage({ start: f.start, end: f.end, today }),
    value,
    credit_pct: creditPct(value, f.creditLimit),
    children: children.length,
  };
}

/** R46 · ngày của con nằm ngoài hiệu lực HĐ NT ⇒ cảnh báo (không chặn). Thiếu ngày ⇒ không cảnh báo. */
export function dateOutsideFrame(
  day: string | null,
  frame: { start: string | null; end: string | null },
): boolean {
  if (day === null) return false;
  return (frame.start !== null && day < frame.start) || (frame.end !== null && day > frame.end);
}

/** R44 · HĐ NT chỉ có mốc nhắc gia hạn + khác (không tiền, không giao/kho). ≡ trigger `obligations_doc_frame`. */
export function frameMilestoneAllowed(kind: string): boolean {
  return kind === "renewal" || kind === "other";
}

export type AttachVerdict = "ok" | "frame_invalid" | "child_invalid" | "partner_mismatch";

/** R43 · gắn con vào HĐ NT: cha là HĐ NT; con là HĐ/giao dịch (không phụ lục); cùng đối tác + hướng khi cả hai phía đã biết. */
export function attachVerdict(
  frame: { docType: string; partnerKey: string | null; direction: string | null },
  child: { docType: string; kind: string; partnerKey: string | null; direction: string | null },
): AttachVerdict {
  if (frame.docType !== "framework") return "frame_invalid";
  if (child.docType === "framework" || child.kind !== "contract") return "child_invalid";
  const differ = (a: string | null, b: string | null) => a !== null && b !== null && a !== b;
  if (differ(frame.partnerKey, child.partnerKey) || differ(frame.direction, child.direction))
    return "partner_mismatch";
  return "ok";
}

/** Câu 9 · AI gợi ý loại chứng từ: chuẩn hoá chữ thường; ngoài 3 loại ⇒ null (người dùng chọn). */
export function parseDocTypeSuggest(v: unknown): DocType | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return (DOC_TYPES as readonly string[]).includes(s) ? (s as DocType) : null;
}
