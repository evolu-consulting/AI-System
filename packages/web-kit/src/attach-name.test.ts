// CR-195 BR-195-5/6 · tên tệp cắt giữa giữ đuôi + chọn nút «Xem» theo loại tệp.
import { describe, expect, test } from "bun:test";
import { type AttachItem, canViewItem, isTextItem, nameParts } from "./attach-layout";

const it = (name: string, mime: string, disabled = false): AttachItem => ({
  id: "1",
  name,
  mime,
  disabled,
});

describe("nameParts", () => {
  test("tên ngắn giữ nguyên, không có đuôi tách", () => {
    expect(nameParts("a.pdf")).toEqual({ head: "a.pdf", tail: "" });
  });
  test("tên dài ⇒ đuôi gồm 3 ký tự cuối tên + phần mở rộng", () => {
    const r = nameParts("pha-dao-ki-nang-giao-tiep.pdf");
    expect(r.tail).toBe("iep.pdf");
    expect(r.head + r.tail).toBe("pha-dao-ki-nang-giao-tiep.pdf");
  });
  test("không có phần mở rộng ⇒ giữ 3 ký tự cuối", () => {
    const r = nameParts("ten-rat-dai-khong-co-duoi");
    expect(r.tail).toBe("uoi");
  });
});

describe("canViewItem", () => {
  test("txt/csv/md và PDF có «Xem»", () => {
    expect(isTextItem(it("english.txt", "text/plain"))).toBe(true);
    expect(isTextItem(it("a.csv", "application/octet-stream"))).toBe(true);
    expect(canViewItem(it("a.md", "text/markdown"))).toBe(true);
    expect(canViewItem(it("a.pdf", "application/pdf"))).toBe(true);
  });
  test("zip/docx/ảnh/tệp tắt không có «Xem»", () => {
    expect(canViewItem(it("a.zip", "application/zip"))).toBe(false);
    expect(canViewItem(it("a.txt", "text/plain", true))).toBe(false);
  });
});
