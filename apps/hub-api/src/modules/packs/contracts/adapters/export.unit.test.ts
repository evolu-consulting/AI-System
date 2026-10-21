// Gap #8: định dạng ô xuất tệp (nhãn VN, tiền/ngày/giờ), CSV (BOM-free dòng, trích dẫn, chống công thức) và luồng .xlsx hợp lệ.
import { describe, expect, it } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import {
  CSV_HEADER_LINE,
  csvLine,
  EXPORT_COLUMNS,
  excelDateSerial,
  excelDateTimeSerial,
  exportCells,
  exportFileName,
  guardFormula,
  viDate,
  viDateTime,
} from "../domain/export.rules";
import { colName, xlsxStream } from "./xlsx-stream";

const row = {
  number: "HD-001",
  title: 'Hợp đồng "bao bì", Minh Phát',
  kind: "contract",
  type: "purchase",
  direction: "purchase",
  status: "expiring",
  seller: "Công ty Minh Phát",
  buyer: null,
  sellerSigner: null,
  buyerSigner: "Lê Văn C",
  value: 1_500_000_000,
  endDate: "2026-12-31",
  actionDeadline: null,
  ownerUserId: "u1",
  categories: ["Bao bì", "Vận chuyển"],
  updatedAt: new Date("2026-03-01T17:30:00Z"), // 00:30 ngày 02/03 giờ VN
};
const owners = new Map([["u1", "Trần Thị Lan"]]);
const TZ = "Asia/Ho_Chi_Minh";

describe("Gap #8 · định dạng", () => {
  it("ngày/giờ: dd/mm/yyyy, giờ theo múi tenant, serial Excel", () => {
    expect(viDate("2026-12-31")).toBe("31/12/2026");
    expect(viDateTime(row.updatedAt, TZ)).toBe("02/03/2026 00:30");
    expect(excelDateSerial("2026-01-01")).toBe(46023);
    expect(excelDateSerial("1900-03-01")).toBe(61);
    expect(excelDateTimeSerial(row.updatedAt, TZ)).toBeCloseTo(46083 + 30 / 1440, 6);
  });
  it("ô: nhãn tiếng Việt, tiền là số, trống là null, loại hàng nối dấu phẩy", () => {
    const cells = exportCells(row, 1, owners);
    const by = Object.fromEntries(EXPORT_COLUMNS.map((c, i) => [c.key, cells[i]]));
    expect(by).toMatchObject({
      stt: "1",
      kind: "Hợp đồng",
      type: "Mua bán hàng hoá",
      direction: "Mua vào",
      status: "Sắp đáo hạn",
      owner: "Trần Thị Lan",
      categories: "Bao bì, Vận chuyển",
      value: 1_500_000_000,
      buyer: null,
    });
    expect(exportCells({ ...row, direction: null }, 2, owners)[5]).toBe("Chưa rõ");
  });
  it("CSV: tiêu đề tiếng Việt, trích dẫn dấu phẩy/nháy, tiền số nguyên, ngày dd/mm/yyyy, CRLF", () => {
    expect(CSV_HEADER_LINE.startsWith("STT,Số hợp đồng,Tên hợp đồng,")).toBe(true);
    const line = csvLine(exportCells(row, 1, owners), TZ);
    expect(line.endsWith("\r\n")).toBe(true);
    expect(line).toContain('"Hợp đồng ""bao bì"", Minh Phát"');
    expect(line).toContain(",1500000000,31/12/2026,,Sắp đáo hạn,");
    expect(line).toContain(",02/03/2026 00:30");
  });
  it("CSV chống công thức: ô chữ bắt đầu = + - @ ⇒ thêm nháy đơn; số âm không bị đụng", () => {
    expect(guardFormula("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(guardFormula("-1+1")).toBe("'-1+1");
    expect(guardFormula("Bình thường")).toBe("Bình thường");
    const cells = exportCells({ ...row, title: "=cmd|x", value: -5 }, 1, owners);
    const line = csvLine(cells, TZ);
    expect(line).toContain("'=cmd|x");
    expect(line).toContain(",-5,");
  });
  it("tên tệp theo ngày tenant", () => {
    expect(exportFileName("2026-10-21", "xlsx")).toBe("hop-dong-20261021.xlsx");
  });
});

async function bytesOf(rs: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(rs).arrayBuffer());
}

describe("Gap #8 · xlsx", () => {
  it("colName: A…Z, AA", () => {
    expect([0, 25, 26, 701].map(colName)).toEqual(["A", "Z", "AA", "ZZ"]);
  });
  it("zip hợp lệ: có đủ phần, tiêu đề + 2 hàng, kiểu số/ngày, XML thoát ký tự", async () => {
    const rows = [
      exportCells(row, 1, owners),
      exportCells({ ...row, title: "A & B <x>\u0001", value: null }, 2, owners),
    ];
    const bytes = await bytesOf(
      xlsxStream({
        sheet: "Hợp đồng",
        columns: EXPORT_COLUMNS,
        rows: rows[Symbol.iterator](),
        rowCount: rows.length,
        tz: TZ,
      }),
    );
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] as Uint8Array);
    expect(sheet).toContain("<t>Số hợp đồng</t>");
    expect(sheet).toContain('<c r="K2" s="2"><v>1500000000</v></c>'); // tiền: số + #,##0
    expect(sheet).toContain('<c r="L2" s="3"><v>46387</v></c>'); // 31/12/2026
    expect(sheet).toContain("A &amp; B &lt;x&gt;</t>"); // thoát + bỏ ký tự điều khiển
    expect(sheet).not.toContain('r="K3"'); // value null ⇒ không ô
    expect(sheet.match(/<row /g)?.length).toBe(3);
    expect(sheet).toContain('<autoFilter ref="A1:Q3"/></worksheet>');
    expect(strFromU8(files["xl/workbook.xml"] as Uint8Array)).toContain('name="Hợp đồng"');
  });
});

describe("Gap #8 · xlsx (biên)", () => {
  it("không dòng nào ⇒ vẫn là xlsx hợp lệ chỉ có tiêu đề", async () => {
    const bytes = await bytesOf(
      xlsxStream({
        sheet: "S",
        columns: EXPORT_COLUMNS,
        rows: [][Symbol.iterator](),
        rowCount: 0,
        tz: TZ,
      }),
    );
    const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"] as Uint8Array);
    expect(sheet.match(/<row /g)?.length).toBe(1);
  });
  it("nhiều hơn một lô (2.500 hàng) ⇒ đủ hàng", async () => {
    const one = exportCells(row, 1, owners);
    const rows = Array.from({ length: 2500 }, () => one);
    const bytes = await bytesOf(
      xlsxStream({
        sheet: "S",
        columns: EXPORT_COLUMNS,
        rows: rows[Symbol.iterator](),
        rowCount: rows.length,
        tz: TZ,
      }),
    );
    const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"] as Uint8Array);
    expect(sheet.match(/<row /g)?.length).toBe(2501);
  });
});
