// R1 · N4-FR-02 · port `mgmt-app/api/app/ingest/pipeline.run_ingest`: parse (Markdown/văn bản trực tiếp; DOCX qua worker
// ADR-0024; PDF lớp chữ qua worker ADR-0028, scan ⇒ PDF_NEEDS_OCR) → chia đoạn + lưu (`addDocument`, trùng nội dung ⇒ tài liệu
// cũ) → sinh đồ thị (`graphProducers`: trích thực thể, bí danh, LINKS_TO, SIMILAR/CONFLICTS). Không gọi mạng trong tx.
import {
  type FileFormat,
  fileFormat,
  fitContent,
  guessKind,
  titleOf,
} from "../domain/ingest.rules";
import { type KnowledgeError, LIMITS } from "../domain/knowledge.rules";
import type { GraphReport, graphProducers, IngestUow } from "./graph.producers";
import type { addDocument } from "./knowledge.usecases";
import type { Hit, KnowledgeLog, Who } from "./ports";

export type IngestError =
  | KnowledgeError
  | "FORMAT_UNSUPPORTED"
  | "FILE_EMPTY"
  | "DOCX_UNREADABLE"
  | "DOCX_BUSY"
  | "PDF_UNREADABLE"
  | "PDF_BUSY"
  | "PDF_TOO_LARGE"
  | "PDF_NEEDS_OCR"
  | "PDF_UNSUPPORTED";
export type IngestInput = {
  filename: string;
  bytes: Uint8Array;
  title?: string;
  kind?: "markdown" | "contract";
  source?: string;
  uri?: string | null;
};
export type IngestOutput = {
  documentId: string;
  format: FileFormat;
  kind: "markdown" | "contract";
  chunks: number;
  duplicate: boolean;
  warnings: string[];
  graph: GraphReport | null;
};
/** Cổng chuyển tệp ⇒ văn bản (adapter bọc DocxConverter / PdfConverter của bộ khung gói). Không ném. */
export type ToText = (
  bytes: Uint8Array,
  tenantId: string,
) => Promise<{ ok: true; markdown: string; warnings: string[] } | { ok: false; code: string }>;

export type IngestDeps = {
  add: ReturnType<typeof addDocument>;
  uow: IngestUow;
  docx: ToText | null;
  /** null ⇒ PDF_UNSUPPORTED (chưa cấu hình bộ đọc PDF). */
  pdf: ToText | null;
  produce: ReturnType<typeof graphProducers> | null;
  log?: KnowledgeLog;
};
type R<T> = { ok: true; value: T } | { ok: false; code: IngestError | string };

/** Tệp ⇒ Markdown/văn bản (không ném; lỗi ⇒ mã ổn định). */
async function toText(
  d: IngestDeps,
  fmt: FileFormat,
  bytes: Uint8Array,
  tenantId: string,
): Promise<R<{ md: string; warnings: string[] }>> {
  if (fmt === "text")
    return { ok: true, value: { md: new TextDecoder().decode(bytes), warnings: [] } };
  if (fmt === "docx") {
    if (!d.docx) return { ok: false, code: "FORMAT_UNSUPPORTED" };
    const r = await d.docx(bytes, tenantId);
    return r.ok ? { ok: true, value: { md: r.markdown, warnings: r.warnings } } : r;
  }
  if (fmt === "pdf") {
    if (!d.pdf) return { ok: false, code: "PDF_UNSUPPORTED" };
    const r = await d.pdf(bytes, tenantId);
    return r.ok ? { ok: true, value: { md: r.markdown, warnings: r.warnings } } : r;
  }
  return { ok: false, code: "FORMAT_UNSUPPORTED" };
}

/**
 * F-05: bộ chuyển cho tới 5 M ký tự, kho nhận ≤ `LIMITS.contentMax` ⇒ cắt ở ranh giới đoạn + cảnh báo `truncated` (thay vì
 * chuyển xong rồi báo CONTENT_TOO_LARGE).
 */
function fitText(t: { md: string; warnings: string[] }): { md: string; warnings: string[] } {
  const f = fitContent(t.md, LIMITS.contentMax);
  if (!f.truncated) return t;
  const warnings = t.warnings.includes("truncated") ? t.warnings : [...t.warnings, "truncated"];
  return { md: f.md, warnings };
}

/**
 * F-06: tài liệu + đoạn commit trong MỘT tx (`add`); đồ thị chạy sau (LLM ngoài tx) nên không cùng tx được. Bù lại: nạp lại tài
 * liệu trùng mà CHƯA có đồ thị (lần trước hỏng/sập giữa chừng) ⇒ dựng lại đồ thị; đã có ⇒ không gọi LLM lần nữa.
 */
async function buildGraph(
  d: IngestDeps,
  who: Who,
  doc: { id: string; duplicate: boolean; md: string; kind: "markdown" | "contract" },
): Promise<GraphReport | null> {
  if (!d.produce) return null;
  const { chunks, has } = await d.uow.tenant(who, async (r) => ({
    has: doc.duplicate ? await r.ingest.hasGraph(doc.id) : false,
    chunks: (await r.knowledge.getDocument(doc.id))?.chunks ?? ([] as Hit[]),
  }));
  if (has) return null;
  return d.produce(who, { docId: doc.id, chunks, md: doc.md, kind: doc.kind });
}

export function ingestFile(d: IngestDeps) {
  return async (who: Who, i: IngestInput): Promise<R<IngestOutput>> => {
    if (i.bytes.byteLength === 0) return { ok: false, code: "FILE_EMPTY" };
    const format = fileFormat(i.filename, i.bytes);
    const raw = await toText(d, format, i.bytes, who.tenantId);
    if (!raw.ok) return raw;
    const text = fitText(raw.value);
    const title = (i.title ?? titleOf(i.filename)).trim().slice(0, 300) || "Tài liệu";
    const kind = i.kind ?? guessKind(title, text.md);
    const added = await d.add(who, {
      title,
      content: text.md,
      kind,
      source: i.source ?? "ingest",
      uri: i.uri ?? null,
    });
    if (!added.ok) return added;
    const { documentId, chunks, duplicate } = added.value;
    const graph = await buildGraph(d, who, { id: documentId, duplicate, md: text.md, kind });
    return {
      ok: true,
      value: { documentId, format, kind, chunks, duplicate, warnings: text.warnings, graph },
    };
  };
}
