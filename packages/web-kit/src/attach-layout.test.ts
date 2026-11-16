// CR-164 · bố cục ảnh/tệp dùng chung.
import { describe, expect, test } from "bun:test";
import {
  ATTACH_SIZE,
  fileKind,
  formatBytes,
  imageLayout,
  isPdfItem,
  loadPhase,
  splitAttachments,
  stepIndex,
  thumbFrame,
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

// CR-173 · luật chọn tệp dùng chung.
import {
  acceptTypesLabel,
  attachPickLabels,
  matchesAccept,
  rejectText,
  validateFiles,
} from "./attach-layout";

const f = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type });

describe("CR-173 · validateFiles", () => {
  test("accept theo đuôi, MIME đủ và nhóm image/*", () => {
    expect(matchesAccept(f("a.PDF", ""), ".pdf,.docx")).toBe(true);
    expect(matchesAccept(f("a.png", "image/png"), "image/*")).toBe(true);
    expect(matchesAccept(f("a.exe", "application/x-msdownload"), ".pdf,image/*")).toBe(false);
    expect(matchesAccept(f("a.exe", ""), undefined)).toBe(true);
  });
  test("tách sai loại, quá cỡ, quá số lượng theo thứ tự", () => {
    const r = validateFiles(
      [
        f("a.pdf", "application/pdf"),
        f("b.exe", ""),
        f("c.pdf", "", 100),
        f("d.pdf", ""),
        f("e.pdf", ""),
      ],
      { accept: ".pdf", maxBytes: 50, maxFiles: 2 },
      0,
    );
    expect(r.ok.map((x) => x.name)).toEqual(["a.pdf", "d.pdf"]);
    expect(r.rejects).toEqual([
      { name: "b.exe", reason: "type" },
      { name: "c.pdf", reason: "size" },
      { name: "e.pdf", reason: "count" },
    ]);
  });
  test("tệp đã có tính vào số lượng tối đa", () => {
    const r = validateFiles([f("a.pdf", "")], { maxFiles: 1 }, 1);
    expect(r.ok).toEqual([]);
    expect(r.rejects[0]?.reason).toBe("count");
  });
  test("nhãn loại tệp + câu lỗi", () => {
    expect(acceptTypesLabel(".pdf,.docx,.pdf,image/*", "ảnh")).toBe("PDF, DOCX, ảnh");
    const labels = attachPickLabels((k, o) => `${k}${o ? JSON.stringify(o) : ""}`, "p");
    expect(rejectText({ name: "x", reason: "size" }, labels, { maxBytes: 2048 })).toContain("2 KB");
    expect(rejectText({ name: "x", reason: "type" }, labels, {})).toBe('p.badType{"name":"x"}');
  });
});

describe("CR-179 · khung tệp cố định", () => {
  test("loadPhase đổi theo URL, onLoad và lỗi", () => {
    expect(loadPhase({ url: null, failed: false, loaded: false })).toBe("loading");
    expect(loadPhase({ url: "blob:x", failed: false, loaded: false })).toBe("loading");
    expect(loadPhase({ url: "blob:x", failed: false, loaded: true })).toBe("ready");
    expect(loadPhase({ url: null, failed: true, loaded: false })).toBe("error");
  });
  test("thumbFrame ảnh đơn có tỉ lệ và rộng tối đa cố định", () => {
    expect(thumbFrame(true)).toEqual({
      aspectRatio: ATTACH_SIZE.oneRatio,
      width: "100%",
      maxWidth: ATTACH_SIZE.oneMaxWidth,
    });
    expect(thumbFrame(false)).toEqual({});
  });
  test("hằng cố định: thẻ tệp và chip có chiều cao > 0", () => {
    expect(ATTACH_SIZE.cardHeight).toBeGreaterThan(0);
    expect(ATTACH_SIZE.chipHeightCompact).toBeLessThan(ATTACH_SIZE.chipHeight);
  });
});
