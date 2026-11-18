// CR-127 · E4 · `GET /contracts/:id/approval-record` — hồ sơ duyệt: mọi quyết định + bằng chứng, lọc theo BR-26 (người chỉ xem không
// thấy ý kiến/tệp). Lớp 2: chỉ cổng. Hai lần đọc: (1) tx gói: trạng thái lượt + `stage_decided` + bằng chứng (MỘT câu, DEFINER theo
// tenant); (2) `stepsView` của engine (tên người, ai quyết được bước đang mở). HĐ không thấy / tenant khác ⇒ null (404).
import type { ApprovalRecord } from "@ai/contracts/pack-contracts";
import { logger } from "../../../../lib/logger";
import type { PackWho } from "../../kit/public";
import { type PdfImage, renderApprovalRecordPdf } from "../adapters/approval-record.pdf";
import { buildApprovalRecord, canReadEvidence } from "../domain/approval-record.rules";
import type { ApprovalState } from "./approval.ports";
import type { ApprovalEngineRepo } from "./approval-engine.ports";
import type { EngineCardDeps } from "./approval-engine-card.usecase";

type RecordRepos = {
  approval: { state(id: string, o: { lock: boolean }): Promise<unknown> };
  approvalEngine: Pick<ApprovalEngineRepo, "decisionsOf" | "signsOf" | "savedRecord"> & {
    labels?: ApprovalEngineRepo["labels"];
  };
};
export type ApprovalRecordDeps = Pick<
  EngineCardDeps,
  | "port"
  | "isAdmin"
  | "evidenceBytes"
  | "evidenceNames"
  | "stampPng"
  | "savedBytes"
  | "userNames"
  | "savePdf"
> & {
  uow: { tenant<T>(who: PackWho, fn: (r: RecordRepos) => Promise<T>): Promise<T> };
};

/** Tên người ký không có bước duyệt (một câu theo lô). */
async function fillSignerNames(
  d: ApprovalRecordDeps,
  who: PackWho,
  names: Map<string, string>,
  signs: readonly { signedBy: string; onBehalfOf?: string | null }[],
) {
  const missing = [
    ...new Set(
      signs.flatMap((x) => [x.signedBy, x.onBehalfOf ?? ""]).filter((u) => u && !names.has(u)),
    ),
  ];
  if (missing.length > 0 && d.userNames)
    for (const [k, v] of await d.userNames(who, missing)) names.set(k, v);
}

/** Hồ sơ đã đọc + người xem có được đọc NỘI DUNG bằng chứng không (BR-26). HĐ không thấy / tenant khác ⇒ null. */
async function loadRecord(d: ApprovalRecordDeps, who: PackWho, id: string, full = false) {
  const got = await d.uow.tenant(who, async (r) => {
    const st = (await r.approval.state(id, { lock: false })) as ApprovalState | null;
    if (!st) return null;
    const rows = (await r.approvalEngine.decisionsOf?.(id)) ?? [];
    const label = (await r.approvalEngine.labels?.([id]))?.[0]; // tên HĐ (một nguồn `contractNameSql`) — cho PDF
    const signs = (await r.approvalEngine.signsOf?.(id)) ?? [];
    const sv = (await r.approvalEngine.savedRecord?.(id)) ?? { done: false, saved: null };
    return { st, rows, label, signs, saved: sv.saved, done: sv.done };
  });
  if (!got) return null;
  const a = got.st.approval;
  const port = d.port();
  const sv =
    port && a?.engineRunId ? await port.stepsView({ ...who, role: "member" }, a.engineRunId) : null;
  const names = new Map<string, string>();
  const involved = new Set<string>(got.rows.map((x) => x.actor));
  for (const s of sv?.steps ?? []) {
    if (s.decided_by) {
      names.set(s.decided_by.id, s.decided_by.name);
      involved.add(s.decided_by.id);
    }
    if (s.task?.can_act) involved.add(who.userId); // quyết được bước đang mở (kể cả trưởng phòng duyệt)
  }
  await fillSignerNames(d, who, names, got.signs);
  const admin = (await d.isAdmin?.(who)) ?? false;
  // `full` = bản lưu trữ do hệ thống lập khi HĐ ký đủ (đủ ý kiến/tệp; chỉ trả lại cho người trong quy trình).
  const readable =
    full ||
    canReadEvidence(
      { userId: who.userId, admin },
      { startedBy: a?.startedBy ?? "", owner: got.st.owner ?? null, involved },
    );
  // Tên người ký (không có bước duyệt) — chỉ khi `names` chưa có: lấy từ bước đã quyết; người còn lại hiện «(không rõ)».
  return {
    rows: got.rows,
    names,
    readable,
    label: got.label,
    signs: got.signs,
    saved: got.saved,
    done: got.done,
  };
}

/**
 * CR-181 · s10 · «lập khi cần»: HĐ đã ký đủ (DONE, có bản ký hoặc quyết định) mà chưa có bản lưu HỢP LỆ (khớp tập bản ký cuối hiện hành) ⇒ lập + lưu
 * ngay (ai xem trước cũng kích hoạt; NOTIFY chỉ là đường nhanh). `savePdf` giữ khoá advisory theo HĐ; lỗi lưu chỉ ghi log (lần xem sau thử lại).
 * Trả bản vừa lưu (đủ nội dung — người gọi chỉ dùng khi người xem đọc được), null nếu không lưu mới.
 */
async function ensureSaved(
  d: ApprovalRecordDeps,
  who: PackWho,
  id: string,
  rec: { done: boolean; saved: unknown; signs: readonly unknown[]; rows: readonly unknown[] },
): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (!d.savePdf || !rec.done || rec.saved || (rec.signs.length === 0 && rec.rows.length === 0))
    return null;
  return d
    .savePdf(who, id, () => approvalRecordArchive(d)(who, id))
    .catch((e: unknown) => {
      logger.warn("approval-record-save-failed", {
        contract_id: id,
        error: e instanceof Error ? e.name : "unknown",
      });
      return null;
    });
}

export function approvalRecord(d: ApprovalRecordDeps) {
  return async (who: PackWho, id: string): Promise<ApprovalRecord | null> => {
    const rec = await loadRecord(d, who, id);
    if (!rec) return null;
    await ensureSaved(d, who, id, rec);
    const out: ApprovalRecord = buildApprovalRecord(rec.rows, rec.names, rec.readable, rec.signs);
    if (!rec.readable || !d.evidenceNames) return out;
    // CR-144 · MỘT câu theo lô: tên + loại tệp của mọi bằng chứng đọc được (không truy vấn theo từng tệp).
    const meta = await d.evidenceNames(
      who.tenantId,
      out.items.flatMap((x) => (x.evidence?.readable ? [x.evidence.id] : [])),
    );
    const items = out.items.map((x) => {
      if (!x.evidence) return x;
      const ids = [
        ...(x.evidence.signature_attachment_id ? [x.evidence.signature_attachment_id] : []),
        ...x.evidence.attachment_ids,
      ];
      const files = ids.flatMap((id) => {
        const m = meta.get(id);
        return m ? [{ id, name: m.name, mime: m.mime }] : [];
      });
      return { ...x, evidence: { ...x.evidence, files } };
    });
    return { ...out, items };
  };
}

/** Ảnh chữ ký cho PDF: chữ ký đã in = MỘT câu hub theo lô (`stampPng`); ảnh bằng chứng duyệt (chỉ khi đọc được, png/jpg) = mỗi ảnh MỘT lần đọc kho, chạy song song (≤ số bước duyệt, tối đa 200). */
async function pdfImages(
  d: ApprovalRecordDeps,
  tenantId: string,
  out: ReturnType<typeof buildApprovalRecord>,
  meta: ReadonlyMap<string, { name: string; mime: string }>,
): Promise<Map<string, PdfImage>> {
  const images = new Map<string, PdfImage>();
  const kindOf = (m: string) => (m === "image/png" ? "png" : m === "image/jpeg" ? "jpg" : null);
  const stampIds = [...new Set((out.signs ?? []).flatMap((x) => (x.stamp_id ? [x.stamp_id] : [])))];
  if (stampIds.length > 0 && d.stampPng)
    for (const [k, bytes] of await d.stampPng(tenantId, stampIds))
      images.set(`stamp:${k}`, { bytes, kind: "png" });
  const evs = out.items.flatMap((x) =>
    x.evidence?.readable && x.evidence.signature_attachment_id
      ? [{ ev: x.evidence.id, file: x.evidence.signature_attachment_id }]
      : [],
  );
  if (d.evidenceBytes)
    await Promise.all(
      evs.map(async ({ ev, file }) => {
        const kind = kindOf(meta.get(file)?.mime ?? "");
        const f = kind ? await d.evidenceBytes?.(tenantId, ev, file) : null;
        if (f && kind) images.set(`ev:${ev}`, { bytes: f.bytes, kind });
      }),
    );
  return images;
}

async function buildRecordPdf(
  d: ApprovalRecordDeps,
  who: PackWho,
  id: string,
  now: () => Date,
  full: boolean,
): Promise<{
  name: string;
  bytes: Uint8Array;
  readable: boolean;
  saved: SavedRef | null;
  empty: boolean;
} | null> {
  const rec = await loadRecord(d, who, id, full);
  if (!rec) return null;
  const out = buildApprovalRecord(rec.rows, rec.names, rec.readable, rec.signs);
  const evIds = out.items.flatMap((x) => (x.evidence?.readable ? [x.evidence.id] : []));
  const fileNames = new Map<string, string>();
  let meta = new Map<string, { name: string; mime: string }>();
  if (rec.readable && d.evidenceNames) {
    meta = await d.evidenceNames(who.tenantId, evIds);
    for (const [k, m] of meta) fileNames.set(k, m.name);
  }
  const bytes = await renderApprovalRecordPdf({
    contract: { name: rec.label?.title ?? "", number: rec.label?.number ?? null },
    items: out.items,
    canReadEvidence: out.can_read_evidence,
    fileNames,
    files: out.files ?? [],
    images: await pdfImages(d, who.tenantId, out, meta),
    generatedAt: now().toISOString(),
  });
  const name = `ho-so-duyet-${rec.label?.number ?? id.slice(0, 8)}.pdf`.replace(
    /[^A-Za-z0-9._-]/g,
    "-",
  );
  const empty = out.items.length === 0 && (out.files?.length ?? 0) === 0;
  return { name, bytes, readable: rec.readable, saved: rec.saved, empty };
}
type SavedRef = { org: string; fileId: string; name: string };

/**
 * CR-127 · U4b-3 · PDF "Hồ sơ duyệt": dựng từ CHÍNH `buildApprovalRecord` (một nguồn với JSON, đã lọc BR-26) + tên HĐ + tên tệp bằng chứng.
 * CR-181 · s10 · đã có bản lưu (HĐ ký đủ) ⇒ trả bản lưu, CHỈ cho người đọc được nội dung (bản lưu đủ ý kiến/tệp); người chỉ xem luôn nhận bản lập
 * ngay đã lọc. HĐ không thấy / tenant khác ⇒ null (404).
 */
export function approvalRecordPdf(d: ApprovalRecordDeps, now: () => Date = () => new Date()) {
  return async (who: PackWho, id: string): Promise<{ name: string; bytes: Uint8Array } | null> => {
    const rec = await loadRecord(d, who, id);
    if (!rec) return null;
    const fresh = await ensureSaved(d, who, id, rec);
    if (rec.readable && fresh) return fresh;
    if (rec.readable && rec.saved && d.savedBytes) {
      const bytes = await d.savedBytes(rec.saved.org, rec.saved.fileId);
      if (bytes) return { name: rec.saved.name, bytes };
    }
    const r = await buildRecordPdf(d, who, id, now, false);
    return r ? { name: r.name, bytes: r.bytes } : null;
  };
}

/** Bản lưu trữ khi HĐ ký đủ: đủ nội dung (không lọc theo người xem), hệ thống lập. */
export function approvalRecordArchive(d: ApprovalRecordDeps, now: () => Date = () => new Date()) {
  return async (who: PackWho, id: string): Promise<{ name: string; bytes: Uint8Array } | null> => {
    const r = await buildRecordPdf(d, who, id, now, true);
    return r && !r.empty ? { name: r.name, bytes: r.bytes } : null;
  };
}

/** BR-X2 · ảnh chữ ký đã in: ai xem được HĐ cũng thấy; CHỈ ảnh thuộc một bản đã ký (không huỷ) của CHÍNH HĐ này. Sai ⇒ null (404). */
export function approvalStampFile(d: ApprovalRecordDeps) {
  return async (who: PackWho, id: string, stampId: string): Promise<Uint8Array | null> => {
    if (!d.stampPng) return null;
    const rec = await loadRecord(d, who, id);
    const sid = stampId.toLowerCase();
    if (!rec?.signs.some((x) => x.stampId === sid)) return null;
    return (await d.stampPng(who.tenantId, [sid])).get(sid) ?? null;
  };
}

export type EvidenceFile = { name: string; mime: string; bytes: Uint8Array };

/**
 * CR-127 · E4b · tải tệp / chữ ký của bằng chứng (BR-26). Cấp byte CHỈ khi: HĐ thuộc tenant, bằng chứng nằm trong hồ sơ duyệt của HĐ này,
 * `fileId` là chữ ký hoặc tệp của CHÍNH bằng chứng đó, và người xem đọc được nội dung (`canReadEvidence`). Mọi trường hợp sai ⇒ null (404).
 */
export function approvalEvidenceFile(d: ApprovalRecordDeps) {
  return async (
    who: PackWho,
    id: string,
    evidenceId: string,
    fileId: string,
  ): Promise<EvidenceFile | null> => {
    if (!d.evidenceBytes) return null;
    const rec = await loadRecord(d, who, id);
    if (!rec?.readable) return null;
    const ev = rec.rows.find((x) => x.evidence?.id === evidenceId)?.evidence;
    if (!ev) return null;
    const f = fileId.toLowerCase();
    const own = ev.signature_attachment_id === f || ev.attachment_ids.includes(f);
    return own ? d.evidenceBytes(who.tenantId, evidenceId, f) : null;
  };
}
