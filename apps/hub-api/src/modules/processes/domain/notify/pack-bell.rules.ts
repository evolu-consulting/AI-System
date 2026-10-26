// contract-flow S1b · luật thuần: notice "Quy trình" của run gắn bản ghi gói ⇒ mục chuông của gói (`notify.enqueue_pack_runs`,
// migrations-hub/0059). Tenant, nguồn, link do SQL lấy từ hàng run; ở đây chỉ dựng kind + tiêu đề + khoá chống trùng (= id
// notice). Không chứa nội dung output/phản hồi. Không DB.

export type BellSource = {
  /** id notice (`hub.process_notices.id`) ⇒ `dedup_key`. */
  id: string;
  userId: string;
  processRunId: string;
  payload: Record<string, unknown>;
};
export type PackBell = {
  run_id: string;
  user_id: string;
  kind: string;
  title: string;
  dedup_key: string;
};

const TITLE_MAX = 200;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const CLOSED: Record<string, string> = {
  pass: "Đã duyệt",
  fail: "Trả lại",
  reject: "Từ chối",
};
const OPENED: Record<string, string> = {
  review_requested: "Cần duyệt",
  ask_requested: "Cần trả lời",
  decision_requested: "Cần quyết định",
  reminder: "Nhắc duyệt",
  escalated: "Chuyển cấp duyệt",
};

/** Tiêu đề chuông (≤ 200 ký tự, không rỗng): "<hành động>: <bước>" — bước vắng ⇒ tên quy trình. */
export function packBellTitle(kind: string, payload: Record<string, unknown>): string {
  const stage = str(payload.stage_name) || str(payload.process_name) || "Quy trình duyệt";
  let head: string;
  if (kind === "task_closed") head = CLOSED[str(payload.result)] ?? "Đã quyết";
  else if (kind === "run_finished") head = "Kết thúc duyệt";
  else head = OPENED[kind] ?? "Quy trình duyệt";
  const subject = kind === "run_finished" ? str(payload.process_name) || stage : stage;
  return `${head}: ${subject}`.slice(0, TITLE_MAX);
}

/** Mỗi notice ⇒ một mục chuông `approval.<kind>`; SQL bỏ hàng của run không gắn gói. */
export function packBellsOf(kind: string, rows: readonly BellSource[]): PackBell[] {
  return rows.map((r) => ({
    run_id: r.processRunId,
    user_id: r.userId,
    kind: `approval.${kind}`,
    title: packBellTitle(kind, r.payload),
    dedup_key: r.id,
  }));
}
