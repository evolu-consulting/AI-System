import { describe, expect, test } from "bun:test";
import { filenameFromDisposition } from "./download";

describe("ADM-FR-54 · filenameFromDisposition", () => {
  test("filename dạng thường", () => {
    expect(filenameFromDisposition('attachment; filename="usage-2026-10.csv"', "x.csv")).toBe(
      "usage-2026-10.csv",
    );
    expect(filenameFromDisposition("attachment; filename=export.json", "x.json")).toBe(
      "export.json",
    );
  });
  test("filename* UTF-8 ưu tiên", () => {
    expect(
      filenameFromDisposition(
        "attachment; filename=\"a.csv\"; filename*=UTF-8''b%C3%A1o-c%C3%A1o.csv",
        "x",
      ),
    ).toBe("báo-cáo.csv");
  });
  test("không có header / rỗng → fallback", () => {
    expect(filenameFromDisposition(null, "fb.csv")).toBe("fb.csv");
    expect(filenameFromDisposition('attachment; filename=""', "fb.csv")).toBe("fb.csv");
  });
  test("chặn đường dẫn", () => {
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"', "fb")).toBe("passwd");
  });
});
