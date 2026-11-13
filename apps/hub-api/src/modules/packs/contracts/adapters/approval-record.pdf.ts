// CR-127 · U4b-3 · dựng PDF "Hồ sơ duyệt" từ CHÍNH dữ liệu `approval-record` (đã lọc BR-26 — người chỉ xem không có ý kiến/tệp ⇒ PDF cũng không).
// `pdf-lib` (ADR-0039) + `@pdf-lib/fontkit` nhúng phông Be Vietnam Pro (subset, ADR-0042) ⇒ in đúng chữ Việt có dấu. Khổ A4, tự xuống dòng + sang trang.
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";

const FONT_DIR = new URL("./fonts/", import.meta.url);
const fontBytes = (n: string) => readFileSync(new URL(n, FONT_DIR));

type Person = { id: string; display_name: string | null };
export type RecordItem = {
  stage: string;
  action: "approve" | "return" | "reject";
  at: string;
  actor: Person;
  feedback: string | null;
  /** [AUDIT] · Toàn quyền duyệt thay. */
  override?: boolean;
  /** [AUDIT] · uỷ quyền. */
  on_behalf_of?: Person | null;
  evidence: {
    readable: boolean;
    note: string | null;
    signature_attachment_id: string | null;
    attachment_ids: string[];
    by_user: Person;
    on_behalf_of: Person | null;
  } | null;
};
export type RecordPdfInput = {
  contract: { name: string; number: string | null };
  items: readonly RecordItem[];
  canReadEvidence: boolean;
  /** Tên tệp theo id tệp bằng chứng (chỉ khi người xem đọc được). */
  fileNames: ReadonlyMap<string, string>;
  /** Mốc xuất hồ sơ (ISO). */
  generatedAt: string;
};

const ACTION: Record<RecordItem["action"], string> = {
  approve: "Duyệt",
  return: "Trả lại",
  reject: "Từ chối",
};

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const SIZE = 10;
const LEAD = 14;

class Writer {
  page: PDFPage;
  y: number;
  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.page = doc.addPage(A4);
    this.y = A4[1] - M;
  }
  private wrap(text: string, f: PDFFont, size: number, w: number): string[] {
    const out: string[] = [];
    for (const para of text.split(/\r?\n/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const cand = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(cand, size) <= w) line = cand;
        else {
          if (line) out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  }
  line(text: string, o: { bold?: boolean; size?: number; indent?: number; gap?: number } = {}) {
    const f = o.bold ? this.bold : this.font;
    const size = o.size ?? SIZE;
    const indent = o.indent ?? 0;
    for (const l of this.wrap(text, f, size, A4[0] - 2 * M - indent)) {
      if (this.y < M + LEAD) {
        this.page = this.doc.addPage(A4);
        this.y = A4[1] - M;
      }
      this.page.drawText(l, { x: M + indent, y: this.y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
      this.y -= size + 4;
    }
    this.y -= o.gap ?? 0;
  }
}

const who = (p: Person) => p.display_name ?? "(không rõ)";
const when = (iso: string) => iso.replace("T", " ").slice(0, 16) + " UTC";

function itemLines(w: Writer, it: RecordItem, n: number, i: Pick<RecordPdfInput, "fileNames">) {
  w.line(`${n}. ${it.stage || "Bước duyệt"} - ${ACTION[it.action]}`, { bold: true });
  w.line(`Người quyết: ${who(it.actor)} · Lúc: ${when(it.at)}`, { indent: 14 });
  if (it.on_behalf_of && !it.evidence?.on_behalf_of)
    w.line(`Duyệt thay cho: ${who(it.on_behalf_of)} (uỷ quyền)`, { indent: 14 });
  if (it.override)
    w.line("Duyệt thay (Toàn quyền) - không phải người/nhóm được giao của bước", { indent: 14 });
  const ev = it.evidence;
  if (it.feedback) w.line(`Ý kiến: ${it.feedback}`, { indent: 14 });
  if (!ev) return w.line("", { gap: 2 });
  if (ev.on_behalf_of)
    w.line(`Duyệt thay cho: ${who(ev.on_behalf_of)} (người ghi: ${who(ev.by_user)})`, {
      indent: 14,
    });
  if (!ev.readable) {
    w.line("Bằng chứng: có (không hiện nội dung với người chỉ xem)", { indent: 14 });
    return w.line("", { gap: 2 });
  }
  if (ev.note) w.line(`Ghi chú bằng chứng: ${ev.note}`, { indent: 14 });
  const names = ev.attachment_ids.map((id) => i.fileNames.get(id) ?? "(tệp)");
  w.line(`Tệp bằng chứng: ${names.length ? names.join(", ") : "không có"}`, { indent: 14 });
  w.line(`Chữ ký: ${ev.signature_attachment_id ? "có" : "không"}`, { indent: 14, gap: 2 });
}

/** Dựng PDF; trả byte. Không đụng DB/mạng. */
export async function renderApprovalRecordPdf(i: RecordPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Hồ sơ duyệt - ${i.contract.name}`);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes("BeVietnamPro-Regular.ttf"), { subset: true });
  const bold = await doc.embedFont(fontBytes("BeVietnamPro-Bold.ttf"), { subset: true });
  const w = new Writer(doc, font, bold);
  w.line("HỒ SƠ DUYỆT HỢP ĐỒNG", { bold: true, size: 16, gap: 4 });
  w.line(`Hợp đồng: ${i.contract.name}${i.contract.number ? ` (${i.contract.number})` : ""}`, {
    bold: true,
  });
  w.line(`Xuất lúc: ${when(i.generatedAt)}`, { gap: 6 });
  if (!i.canReadEvidence)
    w.line("Bản chỉ xem: ý kiến, tệp và chữ ký của bước duyệt không hiện trong hồ sơ này.", {
      gap: 6,
    });
  if (i.items.length === 0) w.line("Chưa có quyết định nào.");
  for (const [k, it] of i.items.entries()) itemLines(w, it, k + 1, i);
  return doc.save({ useObjectStreams: false });
}
