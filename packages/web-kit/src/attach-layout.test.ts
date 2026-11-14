// CR-164 · bố cục ảnh/tệp dùng chung.
import { describe, expect, test } from "bun:test";
import {
  fileKind,
  formatBytes,
  imageLayout,
  isPdfItem,
  splitAttachments,
  stepIndex,
  truncateMiddle,
} from "./attach-layout";

describe("imageLayout", () => {
  test.each([
    [0, "none", 0, 0],
    [1, "one", 1, 0],
    [2, "two", 2, 0],
    [3, "three", 3, 0],
    [4, "four", 4, 0],
    [7, "four", 4, 3],
  ] as const)("%d ảnh ⇒ %s, hiện %d, dư %d", (n, variant, shown, extra) => {
    expect(imageLayout(n)).toEqual({ variant, shown, extra });
  });
});

describe("splitAttachments", () => {
  test("ảnh + tệp lẫn ⇒ tách giữ thứ tự; ảnh disabled thành tệp", () => {
    const r = splitAttachments([
      { id: "1", name: "a.png", mime: "image/png" },
      { id: "2", name: "b.pdf", mime: "application/pdf" },
      { id: "3", name: "c.jpg", mime: "image/jpeg" },
      { id: "4", name: "d.jpg", mime: "image/jpeg", disabled: true },
    ]);
    expect(r.images.map((x) => x.id)).toEqual(["1", "3"]);
    expect(r.files.map((x) => x.id)).toEqual(["2", "4"]);
  });
});

describe("truncateMiddle", () => {
  test("tên ngắn giữ nguyên", () => expect(truncateMiddle("a.pdf", 32)).toBe("a.pdf"));
  test("tên dài cắt giữa, giữ đuôi và không vượt max", () => {
    const s = truncateMiddle("bao-cao-tai-chinh-quy-3-nam-2026-ban-cuoi.pdf", 24);
    expect(s.length).toBeLessThanOrEqual(24);
    expect(s).toContain("…");
    expect(s.endsWith(".pdf")).toBe(true);
    expect(s.startsWith("bao-cao")).toBe(true);
  });
});

describe("fileKind / isPdfItem / stepIndex / formatBytes", () => {
  test("loại tệp theo MIME rồi đuôi", () => {
    expect(fileKind("application/pdf", "x")).toBe("pdf");
    expect(fileKind("application/octet-stream", "b.XLSX")).toBe("sheet");
    expect(
      fileKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a"),
    ).toBe("doc");
    expect(fileKind("application/zip", "a.zip")).toBe("archive");
    expect(fileKind("application/x", "a")).toBe("other");
  });
  test("PDF xem được, disabled thì không", () => {
    expect(isPdfItem({ id: "1", name: "a.pdf", mime: "application/pdf" })).toBe(true);
    expect(isPdfItem({ id: "1", name: "a.pdf", mime: "application/pdf", disabled: true })).toBe(
      false,
    );
  });
  test("qua lại vòng tròn", () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
  });
  test("dung lượng", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536, "en-US")).toBe("1.5 KB");
  });
});
