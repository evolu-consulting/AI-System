import { describe, expect, test } from "bun:test";
import {
  buildIndex,
  chunkMarkdown,
  expandQuery,
  extractCodes,
  fold,
  type SpecUnit,
  search,
  tokenize,
} from "./spec-find.rules";

const G = [
  ["đối tác", "partner"],
  ["hộp thư đối tác", "partner inbox"],
  ["lát", "slice"],
];

describe("fold/tokenize", () => {
  test("bỏ dấu và đ", () => {
    expect(fold("Đối tác ĐƯỢC chọn")).toBe("doi tac duoc chon");
  });
  test("tách từ, bỏ từ dừng", () => {
    expect(tokenize("Chọn đối tác và người nhận")).toEqual(["chon", "doi", "tac", "nguoi", "nhan"]);
  });
});

describe("expandQuery", () => {
  test("không dấu vẫn khớp cụm có dấu", () => {
    const t = expandQuery("chon doi tac", G).map((x) => x.term);
    expect(t).toContain("partner");
  });
  test("cụm nhiều từ", () => {
    const t = expandQuery("partner inbox", G).map((x) => x.term);
    expect(t).toContain("thu");
    expect(t).toContain("hop");
  });
  test("token gốc nặng hơn token mở rộng", () => {
    const w = Object.fromEntries(expandQuery("lát", G).map((x) => [x.term, x.weight]));
    expect(w.lat).toBe(1);
    expect(w.slice).toBe(0.6);
  });
});

describe("chunkMarkdown", () => {
  const md = "# A\ntext a\n```\n# not heading\n```\n## B\nbody b CR-12\n\n## C\n";
  const u = chunkMarkdown(md, { source: "current", file: "f.md", area: "x", status: "đang chạy" });
  test("cắt theo heading, bỏ mục rỗng và code fence", () => {
    expect(u.map((x) => x.title)).toEqual(["A", "B"]);
    expect(u[1]?.line).toBe(6);
    expect(u[1]?.codes).toEqual(["CR-12"]);
  });
  test("lineOffset", () => {
    const v = chunkMarkdown("## T\nx", {
      source: "delta",
      file: "f",
      area: "a",
      status: "đang làm",
      lineOffset: 10,
    });
    expect(v[0]?.line).toBe(10);
  });
  test("extractCodes", () => {
    expect(extractCodes("CR-095 và ADM-FR-12, ADM-NFR-06")).toEqual([
      "CR-095",
      "ADM-FR-12",
      "ADM-NFR-06",
    ]);
  });
});

describe("BM25", () => {
  const mk = (title: string, text: string, source: SpecUnit["source"] = "current"): SpecUnit => ({
    source,
    file: `${title}.md`,
    line: 1,
    area: "a",
    title,
    codes: [],
    status: "đang chạy",
    text,
  });
  const idx = buildIndex([
    mk("Chọn đối tác", "người gửi chọn đối tác nhận hợp đồng"),
    mk("Thông báo", "gửi email thông báo cho người dùng"),
    mk("Hộp thư", "partner inbox hiển thị hợp đồng"),
  ]);
  test("xếp đúng, bỏ dấu", () => {
    expect(search(idx, "chon doi tac", G)[0]?.unit.title).toBe("Chọn đối tác");
  });
  test("đồng nghĩa Anh→Việt", () => {
    expect(search(idx, "partner", G)[0]?.unit.title).toBe("Chọn đối tác");
  });
  test("không khớp ⇒ rỗng", () => {
    expect(search(idx, "zzzz", G)).toEqual([]);
  });
});
