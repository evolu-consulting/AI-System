// HD-FR-08 · HD-AC09…AC11 · HD-NFR-03 · D-06 · D-09 · plan §5: tải lên hợp đồng. Thứ tự: magic bytes (415) → kind/parent (422)
// → 1 pipeline quota (vượt ⇒ hoàn + 429; lỗi Redis ⇒ 503) → DOCX → FileBox (org `t_<tenant>`) → tx 3 câu (set_config + CTE
// files/contracts/events + outbox) → sau commit `ExtractionStarter`. Lỗi sau INCR ⇒ hoàn quota + gỡ tệp đã lưu.

import type { DocxConverter, PackWho } from "../../kit/public";
import { orgForTenant } from "../../kit/public";
import { type ContractFields, fillFields } from "../domain/fields.rules";
import { nextDayStart } from "../domain/quota-reset.rules";
import { plainText } from "../domain/text-formats.rules";
import {
  markdownText,
  quotaVerdict,
  type SniffedType,
  sniffFileType,
  unreadableFormat,
  uploadDay,
} from "../domain/upload.rules";
import { type ContractFlowGate, emitUploadedFlow, FLOW_OFF } from "./contract-flow.ports";
import {
  type ContractFileStore,
  type ExtractionStarter,
  type NewUploadedContract,
  type UploadCounter,
  type UploadDays,
  type UploadDoc,
  UploadError,
  type UploadExtract,
  type UploadUow,
} from "./upload-contract.ports";

/** Bản sao có chủ đích của `CONTRACT_FILE_MIME` (application không import `@ai/contracts`, ADR-0023); test khớp ở
 * `adapters/hd1-review-fixes.test.ts` (review m-11). */
export const UPLOAD_MIME: Record<SniffedType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
  md: "text/markdown",
  webp: "image/webp",
  gif: "image/gif",
  text: "text/plain",
  office: "application/zip",
};
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];

export type UploadContractDeps = {
  uow: UploadUow;
  counter: UploadCounter;
  files: ContractFileStore;
  docx: DocxConverter;
  /** CR-122 p9 · xlsx/pptx/odt ⇒ chữ (vắng/null ⇒ không đọc được ⇒ `extract_failed`). */
  officeText?: (bytes: Uint8Array) => string | null;
  starter: ExtractionStarter;
  zipNames: (bytes: Uint8Array) => string[];
  /** CR-122 p9 · đếm trang PDF (null = không đếm được ⇒ để bước đọc xử lý) + trần trang; vắng ⇒ không kiểm. */
  pdfPages?: ((bytes: Uint8Array) => Promise<number | null>) & { limit: number };
  limits: { tenant: number; global: number };
  /** tenant-quotas · hạn mức lượt tải/ngày riêng của tenant (Admin); vắng/null ⇒ `limits.tenant` (env). */
  tenantLimitOf?: (tenantId: string) => Promise<number | null>;
  newId: () => string;
  now?: () => Date;
  log?: { warn(msg: string, fields?: Record<string, unknown>): void };
  /** CR-122 A1 · cờ flow bật ⇒ ghi `contract.uploaded` CÙNG tx với hàng HĐ. */
  flow?: ContractFlowGate;
};

export type UploadContractInput = {
  who: PackWho;
  timeZone: string;
  bytes: Uint8Array;
  name: string;
  title: string;
  kind: "contract" | "appendix";
  parentId: string | null;
  /** CR-097 K2 · HD-FR-101: "Tải bản cập nhật" cho HĐ này ⇒ nháp v(n+1) cùng chuỗi (`kind`/`parentId` bỏ qua, lấy theo bản cũ). */
  supersedes?: string;
  /** CR-101 DOC-model: loại chứng từ + HĐ NT cha (vắng ⇒ HĐ kinh tế đứng riêng). */
  doc?: UploadDoc;
  /** CR-125 · cr125-contract-from-step · HĐ tạo từ bước quy trình: trường điền sẵn (từ phiếu) ⇒ ghi thẳng `draft` + `extract_state = ready`, không mở
   *  lượt duyệt, không xếp AI trích (người dùng đã nhập). Cùng đường ghi tệp + HĐ + quota với tải lên thường. */
  prefill?: { fields: ContractFields };
};
export type UploadContractResult = {
  id: string;
  status: "draft";
  extractState: UploadExtract;
  version: number;
  version_no?: number;
  root_id?: string;
  supersedes_id?: string;
};
export type UploadContract = (i: UploadContractInput) => Promise<UploadContractResult>;

/** Loại tệp theo nội dung; zip chỉ đọc central directory khi 4 byte đầu là `PK\x03\x04`. */
export function sniffUpload(bytes: Uint8Array, zipNames: (b: Uint8Array) => string[], name = "") {
  const zip = ZIP_SIG.every((b, i) => bytes[i] === b);
  return (
    sniffFileType(bytes, zip ? zipNames(bytes) : undefined) ??
    (markdownText(bytes, name) !== null ? "md" : null) ??
    (plainText(bytes, name) !== null ? "text" : null)
  );
}

/** Trước quota/FileBox. CR-101a (K4, Câu 5): ngừng tạo phụ lục mới (sửa đổi đi "Tải bản cập nhật") ⇒ `USE_VERSIONS`;
 *  HĐ kinh tế có `parent_id` ⇒ `PARENT_INVALID`. Bản cập nhật (`supersedes`) lấy loại theo bản cũ ⇒ bỏ qua. */
function precheckKind(i: UploadContractInput): void {
  if (i.supersedes) return;
  if (i.kind === "appendix") throw new UploadError("USE_VERSIONS");
  if (i.parentId !== null) throw new UploadError("PARENT_INVALID");
}

/** Mọi kiểm tra TRƯỚC quota/FileBox/HĐ nháp/AI: loại tệp (HEIC/WEBP báo đúng tên), loại chứng từ, trần trang PDF (422). */
async function precheck(d: UploadContractDeps, i: UploadContractInput): Promise<SniffedType> {
  const type = sniffUpload(i.bytes, d.zipNames, i.name);
  if (!type) {
    // Không nhận ra ⇒ báo rõ định dạng (heic, tiff, …; không biết ⇒ đuôi tệp) để người dùng đổi sang PDF/JPG.
    const ext = /\.([a-z0-9]{1,5})$/i.exec(i.name)?.[1]?.toLowerCase();
    const format = unreadableFormat(i.bytes) ?? ext;
    throw new UploadError("FILE_TYPE", format ? { format } : undefined);
  }
  precheckKind(i);
  const pages = type === "pdf" && d.pdfPages ? await d.pdfPages(i.bytes) : null;
  if (pages !== null && d.pdfPages && pages > d.pdfPages.limit)
    throw new UploadError("FILE_TOO_MANY_PAGES", { pages, limit: d.pdfPages.limit });
  return type;
}

export function createUploadContract(d: UploadContractDeps): UploadContract {
  const now = d.now ?? (() => new Date());
  return async (i) => {
    const type = await precheck(d, i);
    const at = now();
    const days: UploadDays = { tenant: uploadDay(at, i.timeZone), global: uploadDay(at, "UTC") };
    await takeQuota(d, i, days, at);
    let stored: { org: string; fileId: string } | null = null;
    let row: UploadContractResult & { approvalId: string | null };
    try {
      const text = await toText(d, type, i);
      const org = orgForTenant(i.who.tenantId);
      const up = await d.files.put(org, i.name, i.bytes);
      stored = { org, fileId: up.fileId };
      row = await persist(d, i, {
        type,
        text,
        org,
        ...up,
        approvalId: d.starter.opensApproval && text.ok && !i.prefill ? d.newId() : null,
      });
    } catch (e) {
      await d.counter.refund(i.who.tenantId, days).catch(() => undefined);
      if (stored) await d.files.remove(stored.org, stored.fileId).catch(() => undefined);
      throw e;
    }
    const { approvalId, ...out } = row;
    if (!i.prefill) await startExtraction(d, i.who, row.id, approvalId);
    return out;
  };
}

/** Sau commit: HĐ đã tồn tại ⇒ lỗi (kể cả ném ĐỒNG BỘ) chỉ log, KHÔNG hoàn quota, KHÔNG xoá tệp (review m-08). */
async function startExtraction(
  d: UploadContractDeps,
  who: PackWho,
  id: string,
  approvalId: string | null,
): Promise<void> {
  try {
    await (approvalId ? d.starter.start(who, id, approvalId) : d.starter.start(who, id));
  } catch (e) {
    d.log?.warn("contract-extraction-start-failed", {
      contract_id: id,
      error: e instanceof Error ? e.name : "unknown",
    });
  }
}

type Stored = {
  type: SniffedType;
  text: Text;
  org: string;
  fileId: string;
  versionId: string;
  approvalId: string | null;
};
/** Hàng HĐ mới từ lượt tải lên (chưa có id sinh ở `persist`). */
function uploadedRow(
  d: UploadContractDeps,
  i: UploadContractInput,
  s: Stored,
): NewUploadedContract {
  return {
    id: d.newId(),
    fileRowId: d.newId(),
    org: s.org,
    fileId: s.fileId,
    versionId: s.versionId,
    name: i.name,
    mime: UPLOAD_MIME[s.type],
    size: i.bytes.byteLength,
    kind: i.kind,
    parentId: i.parentId,
    title: i.title,
    extractState: i.prefill ? "ready" : s.text.ok ? "reading" : "failed",
    error:
      i.prefill || s.text.ok ? null : s.type === "docx" ? "DOCX_UNREADABLE" : "TEXT_UNREADABLE",
    fields: i.prefill?.fields ?? fillFields({}),
    sourceText: s.text.ok ? s.text.markdown : null,
    userId: i.who.userId,
    approvalId: s.text.ok && !i.prefill ? s.approvalId : null,
    ...(i.doc ? { doc: i.doc } : {}),
  };
}

/** Một tx: `set_config` + một CTE (files → contracts → events) + outbox = 3 câu (+1 khi cờ flow bật: `contract.uploaded`). */
async function persist(
  d: UploadContractDeps,
  i: UploadContractInput,
  s: Stored,
): Promise<UploadContractResult & { approvalId: string | null }> {
  const prep = d.flow ? await d.flow.prepare(i.who.tenantId, i.who.userId) : FLOW_OFF;
  return d.uow.tenant(i.who, async (r) => {
    const row = uploadedRow(d, i, s);
    const out = i.supersedes
      ? await r.upload.insertVersion(row, i.supersedes)
      : await r.upload.insert(row);
    await r.outbox.enqueue([{ entity: "contract", entity_id: out.id, op: "upsert" }]);
    await emitUploadedFlow(r, prep, out.id, s.type, i.who.userId);
    return { ...out, approvalId: s.text.ok && !i.prefill ? s.approvalId : null };
  });
}
/** Hạn mức tải lên/ngày (dùng chung: tải lên, nâng giao dịch thành HĐ — DOC-deals). Vượt ⇒ hoàn + `UPLOAD_QUOTA`. */
export async function takeQuota(
  d: Pick<UploadContractDeps, "counter" | "limits" | "tenantLimitOf">,
  i: { who: PackWho; timeZone: string },
  days: UploadDays,
  at: Date,
): Promise<void> {
  let c: { tenant: number; global: number };
  try {
    c = await d.counter.take(i.who.tenantId, days);
  } catch {
    throw new UploadError("UPLOAD_QUOTA_UNAVAILABLE");
  }
  const own = d.tenantLimitOf ? await d.tenantLimitOf(i.who.tenantId).catch(() => null) : null;
  const limits = own === null ? d.limits : { ...d.limits, tenant: own };
  const v = quotaVerdict(c, limits);
  if (v === "ok") return;
  await d.counter.refund(i.who.tenantId, days).catch(() => undefined);
  const tz = v === "tenant" ? i.timeZone : "UTC";
  throw new UploadError("UPLOAD_QUOTA", {
    scope: v,
    limit: limits[v],
    resets_at: nextDayStart(at, tz).toISOString(),
  });
}

type Text = { ok: true; markdown: string | null } | { ok: false };
/** Chữ lấy được ⇒ ok; null (hỏng/rỗng) ⇒ vẫn lưu, `extract_failed`. */
const fromText = (t: string | null): Text =>
  t === null ? { ok: false } : { ok: true, markdown: t };
/** DOCX ⇒ Markdown; `DOCX_BUSY` ⇒ 503 (người gọi hoàn quota); `DOCX_UNREADABLE` ⇒ vẫn lưu, `extract_failed`.
 * Truyền `tenantId` ⇒ hàng đợi công bằng N1 (tenant đã có việc chờ ⇒ BUSY; review m-03). */
async function toText(
  d: Pick<UploadContractDeps, "docx" | "officeText">,
  type: SniffedType,
  i: UploadContractInput,
): Promise<Text> {
  if (type === "md") return { ok: true, markdown: markdownText(i.bytes, i.name) };
  if (type === "text") return fromText(plainText(i.bytes, i.name));
  if (type === "office") return fromText(d.officeText?.(i.bytes) ?? null);
  if (type !== "docx") return { ok: true, markdown: null };
  const r = await d.docx.toMarkdown(i.bytes, { tenantId: i.who.tenantId });
  if (r.ok) return { ok: true, markdown: r.markdown };
  if (r.code === "DOCX_BUSY") throw new UploadError("DOCX_BUSY");
  return { ok: false };
}
