// R1 · N4-FR-02 · port `mgmt-app/api/app/ingest/pipeline.run_ingest`: parse (Markdown/văn bản trực tiếp; DOCX qua worker
// ADR-0024; PDF lớp chữ qua worker ADR-0028, scan ⇒ PDF_NEEDS_OCR) → chia đoạn + lưu (`addDocument`, trùng nội dung ⇒ tài liệu
// cũ) → sinh đồ thị (`graphProducers`: trích thực thể, bí danh, LINKS_TO, SIMILAR/CONFLICTS). Không gọi mạng trong tx.
import { type FileFormat, fileFormat, guessKind, titleOf } from "../domain/ingest.rules";
import type { GraphReport, graphProducers, IngestUow } from "./graph.producers";
import type { addDocument } from "./knowledge.usecases";
import type { Hit, KnowledgeLog, Who } from "./ports";

export type IngestError =
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

export function ingestFile(d: IngestDeps) {
  return async (who: Who, i: IngestInput): Promise<R<IngestOutput>> => {
    if (i.bytes.byteLength === 0) return { ok: false, code: "FILE_EMPTY" };
    const format = fileFormat(i.filename, i.bytes);
    const text = await toText(d, format, i.bytes, who.tenantId);
    if (!text.ok) return text;
    const title = (i.title ?? titleOf(i.filename)).trim().slice(0, 300) || "Tài liệu";
    const kind = i.kind ?? guessKind(title, text.value.md);
    const added = await d.add(who, {
      title,
      content: text.value.md,
      kind,
      source: i.source ?? "ingest",
      uri: i.uri ?? null,
    });
    if (!added.ok) return added;
    const { documentId, chunks, duplicate } = added.value;
    const base = { documentId, format, kind, chunks, duplicate, warnings: text.value.warnings };
    if (duplicate || !d.produce) return { ok: true, value: { ...base, graph: null } };
    const doc = await d.uow.tenant(who, (r) => r.knowledge.getDocument(documentId));
    const hits: Hit[] = doc?.chunks ?? [];
    const graph = await d.produce(who, documentId, hits, text.value.md, kind);
    return { ok: true, value: { ...base, graph } };
  };
}
