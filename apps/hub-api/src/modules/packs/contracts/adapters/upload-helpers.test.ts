// HD-FR-08 · D-09 · D-17: `zipNames` (chỉ central directory), tên tệp/tiêu đề mặc định, `nextDayStart` (resets_at).
import { describe, expect, it } from "bun:test";
import { zipSync } from "fflate";
import { nextDayStart } from "../domain/quota-reset.rules";
import { cleanFileName, defaultTitle } from "./upload.routes";
import { zipNames } from "./zip-names";

const u8 = (s: string) => new TextEncoder().encode(s);

describe("zipNames", () => {
  it("trả tên phần, không giải nén; zip hỏng ⇒ []", () => {
    const z = zipSync({ "[Content_Types].xml": u8("<T/>"), "word/document.xml": u8("<w/>") });
    expect(zipNames(z).sort()).toEqual(["[Content_Types].xml", "word/document.xml"]);
    expect(zipNames(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9]))).toEqual([]);
  });
});

describe("tên tệp + tiêu đề", () => {
  it("bỏ đường dẫn, ký tự điều khiển; ≤ 255; tiêu đề = bỏ đuôi, ≤ 200", () => {
    expect(cleanFileName("C:\\x\\Hợp\u0000 đồng.pdf")).toBe("Hợp đồng.pdf");
    expect(cleanFileName("")).toBe("file");
    expect(cleanFileName("a".repeat(300))).toHaveLength(255);
    expect(defaultTitle("HD-bao-bi.docx")).toBe("HD-bao-bi");
    expect(defaultTitle(".pdf")).toBe(".pdf");
    expect(defaultTitle(`${"t".repeat(250)}.pdf`)).toHaveLength(200);
  });
});

describe("nextDayStart", () => {
  const at = new Date("2026-10-19T18:30:00Z");
  it("00:00 ngày kế theo múi", () => {
    expect(nextDayStart(at, "UTC").toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(nextDayStart(at, "Asia/Ho_Chi_Minh").toISOString()).toBe("2026-10-20T17:00:00.000Z");
    expect(nextDayStart(at, "Pacific/Kiritimati").toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });
  it("ngày đổi giờ (America/New_York 2026-03-08)", () => {
    expect(nextDayStart(new Date("2026-03-08T12:00:00Z"), "America/New_York").toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
  });
});
