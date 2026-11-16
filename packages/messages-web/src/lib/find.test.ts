// CR-178 · M3 · luật thuần của tìm tin / «Ảnh & tệp» / xem trước.
import { describe, expect, test } from "bun:test";
import type { MessagePage, MsgAttachment, MsgSearchHit } from "@ai/contracts/pack-contracts";
import {
  cycleIndex,
  filterByName,
  groupByMonth,
  highlightParts,
  maxSeq,
  mergeAttachPages,
  mergeSearchPages,
  midTruncate,
  prependNewer,
  previewKind,
  resetAround,
  stepIndex,
} from "./find";

const U = "11111111-1111-4111-8111-111111111111";
const hit = (seq: number, conv = U): MsgSearchHit => ({
  conversation_id: conv,
  kind: "direct",
  title: "An",
  company: null,
  seq,
  sender_id: U,
  sender_name: "An",
  at: "2026-11-10T03:00:00.000Z",
  snippet: "gửi báo giá",
  match: { start: 4, end: 11 },
});
const att = (id: string, at: string, name = "a.pdf", mime = "application/pdf"): MsgAttachment => ({
  file: { id, name, mime, size: 10 } as MsgAttachment["file"],
  kind: mime.startsWith("image/") ? "image" : "file",
  sender_id: U,
  sender_name: "An",
  seq: 1,
  at,
});
const page = (seqs: number[], more = true, newer?: boolean): MessagePage =>
  ({
    items: seqs.map((seq) => ({ seq })),
    has_more: more,
    ...(newer === undefined ? {} : { has_newer: newer }),
  }) as unknown as MessagePage;

describe("tô sáng theo match", () => {
  test("cắt 3 phần quanh chỗ khớp", () => {
    expect(highlightParts("gửi báo giá", { start: 4, end: 11 })).toEqual({
      before: "gửi ",
      hit: "báo giá",
      after: "",
    });
  });
  test("match null / rỗng / ngoài đoạn ⇒ không tô", () => {
    for (const m of [null, { start: 3, end: 3 }, { start: 2, end: 99 }])
      expect(highlightParts("abc", m)).toEqual({ before: "abc", hit: "", after: "" });
  });
});

describe("gộp trang", () => {
  test("kết quả tìm: bỏ trùng (cuộc, seq), giữ thứ tự", () => {
    const out = mergeSearchPages([{ items: [hit(5), hit(4)] }, { items: [hit(4), hit(3)] }]);
    expect(out.map((h) => h.seq)).toEqual([5, 4, 3]);
    expect(
      mergeSearchPages([{ items: [hit(1, U), hit(1, "22222222-2222-4222-8222-222222222222")] }]),
    ).toHaveLength(2);
  });
  test("ảnh & tệp: bỏ trùng", () => {
    const a = att("f1", "2026-11-01T00:00:00Z");
    expect(
      mergeAttachPages([{ items: [a] }, { items: [a, att("f2", "2026-11-01T00:00:00Z")] }]),
    ).toHaveLength(2);
  });
});

describe("chia ảnh theo tháng", () => {
  test("giữ thứ tự mới ⇒ cũ; tháng liền nhau là một nhóm", () => {
    const g = groupByMonth([
      att("a", "2026-11-15T12:00:00"),
      att("b", "2026-11-02T12:00:00"),
      att("c", "2026-09-20T12:00:00"),
    ]);
    expect(g.map((x) => [x.month, x.items.length])).toEqual([
      ["2026-11", 2],
      ["2026-09", 1],
    ]);
  });
});

describe("lọc tên tệp", () => {
  test("không phân biệt hoa/dấu; rỗng ⇒ tất cả", () => {
    const l = [
      att("1", "2026-11-01T00:00:00Z", "Báo giá Q4.pdf"),
      att("2", "2026-11-01T00:00:00Z", "hop-dong.docx"),
    ];
    expect(filterByName(l, "bao GIA").map((a) => a.file.id)).toEqual(["1"]);
    expect(filterByName(l, "  ")).toHaveLength(2);
  });
  test("cắt giữa giữ đuôi", () => {
    const n = midTruncate("bao-gia-cong-ty-abc-xyz-thang-muoi-mot-2026.pdf", 24);
    expect(n.endsWith(".pdf")).toBe(true);
    expect(n).toContain("…");
    expect(n.length).toBeLessThanOrEqual(24);
    expect(midTruncate("a.pdf")).toBe("a.pdf");
  });
});

describe("kiểu xem trước theo mime", () => {
  test("ảnh raster và PDF xem được", () => {
    for (const m of ["image/png", "image/jpeg", "image/gif", "image/webp"])
      expect(previewKind(m)).toBe("image");
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("application/pdf; charset=binary")).toBe("pdf");
  });
  test("svg, html, Word, Excel, ZIP ⇒ chỉ tải về", () => {
    for (const m of [
      "image/svg+xml",
      "text/html",
      "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "",
    ])
      expect(previewKind(m)).toBe("none");
  });
});

describe("chuyển ‹ › và ↑↓", () => {
  test("‹ › không vòng, ngoài biên ⇒ null", () => {
    expect(stepIndex(0, 3, -1)).toBeNull();
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBeNull();
  });
  test("↑↓ vòng quanh; rỗng ⇒ 0", () => {
    expect(cycleIndex(2, 3, 1)).toBe(0);
    expect(cycleIndex(0, 3, -1)).toBe(2);
    expect(cycleIndex(0, 0, 1)).toBe(0);
  });
});

describe("trang tin quanh around_seq", () => {
  test("thay hẳn danh sách, nhớ param để làm mới đúng trang", () => {
    const r = resetAround(page([8, 9, 10], true, true), 9);
    expect(r.pages).toHaveLength(1);
    expect(r.pageParams).toEqual([{ around: 9 }]);
  });
  test("tin mới hơn thêm lên ĐẦU, trang cũ nhất vẫn ở cuối", () => {
    const base = resetAround(page([8, 9, 10], true, true), 9);
    const next = prependNewer(base, page([10, 11, 12], true, false), 10);
    expect(next.pages).toHaveLength(2);
    expect(next.pages[1]?.items.map((m) => m.seq)).toEqual([8, 9, 10]);
    expect(next.pageParams).toEqual([{ around: 10 }, { around: 9 }]);
    expect(prependNewer(undefined, page([1]), 1).pages).toHaveLength(1);
  });
  test("maxSeq", () => {
    expect(maxSeq([{ seq: 3 }, { seq: 9 }, { seq: 4 }])).toBe(9);
    expect(maxSeq([])).toBe(0);
  });
});
