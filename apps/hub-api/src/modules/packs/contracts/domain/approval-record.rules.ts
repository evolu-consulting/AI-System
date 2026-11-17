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
  /** [AUDIT] · uỷ quyền: người uỷ quyền. */
  onBehalfOf?: string | null;
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

/** Tên bước của dòng hồ sơ cho người ký trên tài liệu (người ký công ty, bước «Ký hợp đồng»). */
export const SIGN_STAGE = "Ký hợp đồng";

const person = (id: string, names: ReadonlyMap<string, string>) => ({
  id,
  display_name: names.get(id) ?? null,
});

/** Dòng hồ sơ ⇒ phản hồi API; không đọc được ⇒ ẩn ý kiến/chữ ký/tệp/`feedback` của bằng chứng (giữ `readable:false`). */
export function buildApprovalRecord(
  rows: readonly RecordRow[],
  names: ReadonlyMap<string, string>,
  readable: boolean,
  signRows: readonly SignVersionRow[] = [],
) {
  const info = signRows.length > 0 ? buildSignInfo(signRows, names) : null;
  const signOf = (id: string) => info?.signs.find((s) => s.user.id === id) ?? null;
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
  const decided = rows.map((r) => ({
    task_id: r.taskId,
    stage: r.stage,
    action: r.action,
    at: r.at,
    actor: person(r.actor, names),
    override: r.override === true,
    on_behalf_of: r.onBehalfOf ? person(r.onBehalfOf, names) : null,
    // `feedback` có thể trùng ý kiến của bằng chứng ⇒ người chỉ xem không nhận khi có bằng chứng kèm.
    feedback: readable || r.evidence === null ? r.feedback : null,
    evidence: r.evidence ? evidenceOf(r.evidence) : null,
    ...(info ? { sign: signOf(r.actor) } : {}),
  }));
  // Bước Ký trên tài liệu: người ký không có quyết định duyệt vẫn có MỘT dòng riêng (ai, bước, lúc nào, loại chữ ký, số tệp).
  const decidedBy = new Set(rows.map((r) => r.actor));
  const signed = (info?.signs ?? [])
    .filter((s) => !decidedBy.has(s.user.id))
    .map((s) => ({
      task_id: s.user.id,
      stage: SIGN_STAGE,
      action: "sign" as const,
      at: s.at,
      actor: s.user,
      override: false,
      on_behalf_of: null,
      feedback: null,
      evidence: null,
      sign: s,
    }));
  const items = [...decided, ...signed].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { items, can_read_evidence: readable, ...(info ?? {}) };
}

// ── CR-181 · s10 · hình chữ ký + tệp + dấu vân tay trong hồ sơ ─────────────────────────────────────────────────────────────────────────
/** Một bản đã ký (không huỷ) của một tệp, kèm chữ ký đầu tiên in trong bản (`stampId`). */
export type SignVersionRow = {
  fileId: string;
  fileName: string;
  outName: string;
  seq: number;
  sha256: string;
  signedBy: string;
  kind: "internal" | "digital";
  at: string;
  stampId: string | null;
};

/** Mã kiểm tra ngắn = 8 ký tự đầu của sha256, viết hoa. */
export const checkCode = (sha256: string): string => sha256.slice(0, 8).toUpperCase();

/**
 * BR-X2: hình chữ ký trên bản đã ký + danh sách tệp (ai xem được HĐ cũng thấy). `signs`: mỗi người MỘT dòng (loại của bản mới nhất người đó ký,
 * lúc ký đầu tiên, số tệp khác nhau đã ký, ảnh = chữ ký in trong bản đầu tiên có ảnh). `files`: mỗi tệp một dòng «gốc» + bản đã ký CUỐI (seq lớn nhất).
 */
export function buildSignInfo(rows: readonly SignVersionRow[], names: ReadonlyMap<string, string>) {
  const ordered = [...rows].sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
  const by = new Map<string, SignVersionRow[]>();
  for (const r of ordered) by.set(r.signedBy, [...(by.get(r.signedBy) ?? []), r]);
  const signs = [...by.entries()].map(([uid, vs]) => ({
    user: person(uid, names),
    kind: (vs[vs.length - 1] as SignVersionRow).kind,
    files_signed: new Set(vs.map((v) => v.fileId)).size,
    at: (vs[0] as SignVersionRow).at,
    stamp_id: vs.find((v) => v.stampId)?.stampId ?? null,
  }));
  const originals = new Map<string, SignVersionRow>();
  const last = new Map<string, SignVersionRow>();
  for (const r of ordered) {
    if (!originals.has(r.fileId)) originals.set(r.fileId, r);
    const cur = last.get(r.fileId);
    if (!cur || r.seq > cur.seq) last.set(r.fileId, r);
  }
  const files = [...originals.values()].flatMap((o) => {
    const l = last.get(o.fileId) as SignVersionRow;
    return [
      {
        kind: "original" as const,
        name: o.fileName,
        sha256: null,
        check_code: null,
        signed_by: null,
        at: null,
      },
      {
        kind: "signed" as const,
        name: l.outName,
        sha256: l.sha256,
        check_code: checkCode(l.sha256),
        signed_by: person(l.signedBy, names),
        at: l.at,
      },
    ];
  });
  return { signs, files };
}
