// CR-121 · R-2 · che secret trong dữ liệu debug (payload job, thông điệp lỗi gốc, nội dung đầu ra) trước khi trả cho
// platform_admin: khoá JSON khớp /secret|token|password|api_key|authorization|cookie/i ⇒ "***" (đệ quy), chuỗi có
// `Bearer …` / `khoá=giá trị` nhạy cảm ⇒ che phần giá trị. Thuần, lớp 1 (không I/O).
export const REDACTED = "***";
const SENSITIVE_KEY = /secret|token|password|api[_-]?key|authorization|cookie/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const KV_SECRET =
  /\b((?:[\w-]*(?:secret|token|password|api[_-]?key)[\w-]*)|authorization|cookie)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/gi;
const MAX_DEPTH = 12;

/** Che secret trong một chuỗi tự do (thông điệp lỗi, nội dung đầu ra). */
export function redactText(s: string): string {
  return s.replace(BEARER, `$1 ${REDACTED}`).replace(KV_SECRET, `$1$2${REDACTED}`);
}

/**
 * CR-127 · E4 · BR-26 · ai đọc được NỘI DUNG bằng chứng (ý kiến, chữ ký, tệp) của một lượt: quản trị công ty / nền tảng, người gửi, người
 * trong quy trình (đang/đã được giao việc của lượt), người phụ trách bản ghi (`owner`). Người chỉ xem (vd thành viên phòng nguồn) chỉ
 * thấy tiến trình. Thuần; `tenantId` khác ⇒ không bao giờ đọc được.
 */
export function evidenceReadable(
  v: { userId: string; tenantId: string; role: "platform_admin" | "tenant_admin" | "member" },
  r: {
    tenantId: string;
    startedBy: string;
    taskAssignee: boolean;
    ownerUserId?: string | null;
    decidedBy?: ReadonlySet<string>;
  },
): boolean {
  if (v.role === "platform_admin") return true;
  if (v.tenantId !== r.tenantId) return false;
  if (v.role === "tenant_admin") return true;
  return (
    v.userId === r.startedBy ||
    r.taskAssignee ||
    (r.ownerUserId != null && r.ownerUserId === v.userId) ||
    (r.decidedBy?.has(v.userId) ?? false)
  );
}

/** CR-127 · E4 · ẩn nội dung bằng chứng với người chỉ xem: giữ id/người/lúc (tiến trình), bỏ ý kiến + chữ ký + tệp. */
export function redactEvidence<
  T extends { note: string; signature_attachment_id: string | null; attachment_ids: string[] },
>(
  ev: T,
  readable: boolean,
):
  | T
  | (Omit<T, "note" | "signature_attachment_id" | "attachment_ids"> & {
      note: null;
      signature_attachment_id: null;
      attachment_ids: [];
    }) {
  if (readable) return ev;
  return { ...ev, note: null, signature_attachment_id: null, attachment_ids: [] };
}

/** CR-127 · E4 · lịch sử của run: người chỉ xem không nhận `evidence_id` (không có id ⇒ không tải được nội dung). */
export function redactHistoryEvidence<T extends { evidence_id?: string; feedback?: string }>(
  items: readonly T[],
  readable: boolean,
): T[] {
  if (readable) return [...items];
  return items.map((h) => {
    if (!h.evidence_id) return h;
    // Dòng có bằng chứng: ẩn cả `feedback` (người dùng có thể đã lặp lại ý kiến ở đó).
    const { evidence_id: _drop, feedback: _fb, ...rest } = h;
    return rest as T;
  });
}

/** Che đệ quy: khoá nhạy cảm ⇒ "***"; chuỗi ⇒ `redactText`; quá sâu ⇒ "***" (không để lọt cấu trúc lạ). */
export function redactJson(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return redactText(v);
  if (v === null || typeof v !== "object") return v;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(v)) return v.map((x) => redactJson(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>))
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactJson(val, depth + 1);
  return out;
}
