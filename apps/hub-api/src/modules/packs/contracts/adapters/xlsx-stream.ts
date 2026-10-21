// Gap #8 · Luật 4c: ghi .xlsx dạng luồng — zip (fflate `Zip` + `ZipDeflate` mức 1) với trang tính XML sinh theo lô, không dựng cả
// tệp trong bộ nhớ và không xếp hàng đợi sự kiện. Ô chữ = `inlineStr` (không cần sharedStrings); tiền = số + định dạng `#,##0`;
// ngày/giờ = serial Excel + định dạng `dd/mm/yyyy`. Dòng tiêu đề đóng băng + bộ lọc tự động.
import { Zip, ZipDeflate } from "fflate";
import {
  type ExportCell,
  type ExportColumn,
  excelDateSerial,
  excelDateTimeSerial,
} from "../domain/export.rules";

const enc = new TextEncoder();
const BATCH = 1000;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** Ký tự không hợp lệ trong XML 1.0 (điều khiển trừ tab/LF/CR). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: chủ ý lọc ký tự điều khiển
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s: string) =>
  s.replace(BAD_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STYLE = { text: 0, header: 1, money: 2, date: 3, datetime: 4 } as const;

const STATIC_FILES: [string, string][] = [
  [
    "[Content_Types].xml",
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  ],
  [
    "_rels/.rels",
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  ],
  [
    "xl/_rels/workbook.xml.rels",
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  ],
  [
    "xl/styles.xml",
    `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs></styleSheet>`,
  ],
];

/** Cột 0 ⇒ A, 25 ⇒ Z, 26 ⇒ AA. */
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cellXml(c: ExportCell, col: ExportColumn, ref: string, tz: string): string {
  if (c === null) return "";
  if (c instanceof Date)
    return `<c r="${ref}" s="${STYLE.datetime}"><v>${excelDateTimeSerial(c, tz)}</v></c>`;
  if (typeof c === "number") {
    const s = col.kind === "money" ? STYLE.money : STYLE.text;
    return `<c r="${ref}" s="${s}"><v>${c}</v></c>`;
  }
  if (col.kind === "date") {
    const n = excelDateSerial(c);
    if (n !== null) return `<c r="${ref}" s="${STYLE.date}"><v>${n}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
}

function rowXml(
  cells: readonly ExportCell[],
  cols: readonly ExportColumn[],
  r: number,
  tz: string,
): string {
  let out = `<row r="${r}">`;
  for (let i = 0; i < cols.length; i++)
    out += cellXml(cells[i] ?? null, cols[i] as ExportColumn, `${colName(i)}${r}`, tz);
  return `${out}</row>`;
}

function headerRow(cols: readonly ExportColumn[]): string {
  const cells = cols
    .map(
      (c, i) =>
        `<c r="${colName(i)}1" s="${STYLE.header}" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`,
    )
    .join("");
  return `<row r="1" ht="22" customHeight="1">${cells}</row>`;
}

function sheetHead(cols: readonly ExportColumn[]): string {
  const widths = cols
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
    .join("");
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths}</cols><sheetData>${headerRow(cols)}`;
}

/** Các phần cố định của gói (kiểu nội dung, quan hệ, kiểu ô, danh sách trang tính). */
function addStaticParts(zip: Zip, sheetName: string): void {
  const book = `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  for (const [name, text] of [...STATIC_FILES, ["xl/workbook.xml", book] as [string, string]]) {
    const f = new ZipDeflate(name, { level: 1 });
    zip.add(f);
    f.push(enc.encode(text), true);
  }
}

/** Luồng .xlsx của `rows` (lặp lười). `tz` = múi tenant cho ô giờ. Lỗi khi sinh ⇒ luồng báo lỗi (response đứt, không tệp hỏng im lặng). */
export function xlsxStream(opts: {
  sheet: string;
  columns: readonly ExportColumn[];
  rows: Iterator<readonly ExportCell[]>;
  rowCount: number;
  tz: string;
}): ReadableStream<Uint8Array> {
  const { columns, rows, tz } = opts;
  let zip: Zip;
  let sheet: ZipDeflate;
  let n = 0;
  return new ReadableStream<Uint8Array>({
    start(ctl) {
      zip = new Zip((err, chunk, final) => {
        if (err) return ctl.error(err);
        ctl.enqueue(chunk);
        if (final) ctl.close();
      });
      addStaticParts(zip, opts.sheet);
      sheet = new ZipDeflate("xl/worksheets/sheet1.xml", { level: 1 });
      zip.add(sheet);
      sheet.push(enc.encode(sheetHead(columns)));
    },
    pull() {
      let xml = "";
      for (let k = 0; k < BATCH; k++) {
        const nx = rows.next();
        if (nx.done) break;
        n++;
        xml += rowXml(nx.value, columns, n + 1, tz);
      }
      if (n >= opts.rowCount || xml === "") {
        const last = `${colName(columns.length - 1)}${n + 1}`;
        sheet.push(
          enc.encode(`${xml}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`),
          true,
        );
        zip.end();
      } else sheet.push(enc.encode(xml));
    },
  });
}
