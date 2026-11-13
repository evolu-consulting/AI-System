// CR-127 · E4 · spec §5.3 · BR-26 · luật thuần của hồ sơ duyệt HĐ (`GET /contracts/:id/approval-record`): ai đọc được NỘI DUNG bằng
// chứng (ý kiến, chữ ký, tệp) và dựng danh sách đã lọc. Người chỉ xem chỉ thấy tiến trình (ai quyết gì lúc nào) + "có bằng chứng".
// Domain chỉ import builtin (ADR-0023).
export type RecordViewer = {
  userId: string;
  /** Quản trị công ty / chủ gói (quyền `admin` của gói). */
  admin: boolean;
};
export type RecordCtx = {
  startedBy: string;
  /** Người phụ trách HĐ. */
  owner: string | null;
  /** Người trong quy trình: đã quyết ở một bước ∪ quyết được bước đang mở (kể cả trưởng phòng duyệt). */
  involved: ReadonlySet<string>;
};
export type RecordRow = {
  taskId: string;
  stage: string;
  action: "approve" | "return" | "reject";
  at: string;
  actor: string;
  feedback: string | null;
  /** [AUDIT] · Toàn quyền duyệt thay (không phải người/nhóm được giao). */
  override?: boolean;
  evidence: {
    id: string;
    note: string;
    signature_attachment_id: string | null;
    attachment_ids: string[];
    by_user: string;
    on_behalf_of: string | null;
    at: string;
  } | null;
};

/** Người trong quy trình ∪ người gửi ∪ người phụ trách HĐ ∪ quản trị công ty. */
export function canReadEvidence(v: RecordViewer, c: RecordCtx): boolean {
  return (
    v.admin ||
    v.userId === c.startedBy ||
    (c.owner !== null && v.userId === c.owner) ||
    c.involved.has(v.userId)
  );
}

const person = (id: string, names: ReadonlyMap<string, string>) => ({
  id,
  display_name: names.get(id) ?? null,
});

/** Dòng hồ sơ ⇒ phản hồi API; không đọc được ⇒ ẩn ý kiến/chữ ký/tệp/`feedback` của bằng chứng (giữ `readable:false`). */
export function buildApprovalRecord(
  rows: readonly RecordRow[],
  names: ReadonlyMap<string, string>,
  readable: boolean,
) {
  const evidenceOf = (e: NonNullable<RecordRow["evidence"]>) => ({
    id: e.id,
    readable,
    note: readable ? e.note : null,
    signature_attachment_id: readable ? e.signature_attachment_id : null,
    attachment_ids: readable ? e.attachment_ids : [],
    by_user: person(e.by_user, names),
    on_behalf_of: e.on_behalf_of ? person(e.on_behalf_of, names) : null,
    at: e.at,
  });
  const items = rows.map((r) => ({
    task_id: r.taskId,
    stage: r.stage,
    action: r.action,
    at: r.at,
    actor: person(r.actor, names),
    override: r.override === true,
    // `feedback` có thể trùng ý kiến của bằng chứng ⇒ người chỉ xem không nhận khi có bằng chứng kèm.
    feedback: readable || r.evidence === null ? r.feedback : null,
    evidence: r.evidence ? evidenceOf(r.evidence) : null,
  }));
  return { items, can_read_evidence: readable };
}
