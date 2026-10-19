// R1 · luật thuần nạp + đồ thị (port mgmt-app parse/chunk/extract/resolve/similar).
import { describe, expect, it } from "bun:test";
import {
  aliasForm,
  cosineSets,
  docProbeTerms,
  entityKey,
  fakeExtract,
  fakeJudge,
  fakeSameEntity,
  firstJson,
  matchForm,
  parseExtraction,
  similarPairs,
  tokenSet,
} from "./extract.rules";
import { extractLinks, fileFormat, guessKind, titleOf } from "./ingest.rules";

const enc = (s: string) => new TextEncoder().encode(s);

describe("ingest.rules", () => {
  it("fileFormat theo đuôi + chữ ký (đuôi giả ⇒ unknown)", () => {
    expect(fileFormat("a.md", enc("# x"))).toBe("text");
    expect(fileFormat("A.TXT", enc("x"))).toBe("text");
    expect(fileFormat("a.docx", new Uint8Array([0x50, 0x4b, 3, 4]))).toBe("docx");
    expect(fileFormat("a.docx", enc("%PDF"))).toBe("unknown");
    expect(fileFormat("a.pdf", enc("%PDF-1.7"))).toBe("pdf");
    expect(fileFormat("a.pdf", enc("hello"))).toBe("unknown");
    expect(fileFormat("a.xlsx", new Uint8Array([0x50, 0x4b, 3, 4]))).toBe("unknown");
  });
  it("titleOf bỏ thư mục/đuôi/gạch; guessKind cần 'hợp đồng' + dòng 'Điều N'", () => {
    expect(titleOf("C:\\docs\\HD-bao_bi-Minh-Phat.docx")).toBe("HD bao bi Minh Phat");
    expect(titleOf(".pdf")).toBe("Tài liệu");
    expect(guessKind("Hợp đồng mua bán", "**Điều 1. Hàng hóa**\nx")).toBe("contract");
    expect(guessKind("Ghi chú", "# HỢP ĐỒNG\n## Điều 2. Giá")).toBe("contract");
    expect(guessKind("Hợp đồng", "không có điều khoản")).toBe("markdown");
    expect(guessKind("Biên bản họp", "Điều 1 là gì")).toBe("markdown");
  });
  it("extractLinks: http(s) Markdown, giữ thứ tự, không trùng", () => {
    const md =
      "[a](https://x.vn/a) [b](http://y.vn) [a2](https://x.vn/a) [c](ftp://z) [d](https://w.vn/d)";
    expect(extractLinks(md)).toEqual(["https://x.vn/a", "http://y.vn", "https://w.vn/d"]);
    expect(extractLinks(md, 1)).toEqual(["https://x.vn/a"]);
  });
});

describe("extract.rules", () => {
  it("entityKey/matchForm/aliasForm như mgmt-app (bỏ dấu, không thứ tự, bỏ danh từ chung đầu)", () => {
    expect(entityKey({ name: " An Nguyễn ", type: "Person" })).toBe("Person:an nguyễn");
    expect(matchForm("Nguyễn Văn An")).toBe("nguyen van an");
    expect(aliasForm("An Nguyễn")).toBe(aliasForm("nguyễn an"));
    expect(aliasForm("Dự án Apollo")).toBe(aliasForm("Apollo"));
    expect(aliasForm("Apollo 2")).not.toBe(aliasForm("Apollo"));
    expect(fakeSameEntity("Phòng Kế toán", "kế toán")).toBe(true);
  });
  it("parseExtraction: bỏ loại lạ/tên rỗng/trùng; quan hệ chỉ giữa thực thể đã trả, kiểu UPPER_SNAKE", () => {
    const ex = parseExtraction({
      entities: [
        { name: "Apollo", type: "Project" },
        { name: "apollo", type: "Project" },
        { name: "An", type: "Person" },
        { name: "", type: "Person" },
        { name: "X", type: "Alien" },
      ],
      relations: [
        { src: "An", dst: "Apollo", type: "LEADS" },
        { src: "An", dst: "Ghost", type: "LEADS" },
        { src: "An", dst: "Apollo", type: "leads" },
      ],
    });
    expect(ex.entities).toEqual([
      { name: "Apollo", type: "Project" },
      { name: "An", type: "Person" },
    ]);
    expect(ex.relations).toEqual([{ src: "An", dst: "Apollo", type: "LEADS" }]);
    expect(parseExtraction(null)).toEqual({ entities: [], relations: [] });
  });
  it("firstJson đọc JSON bọc ```json; hỏng ⇒ null", () => {
    expect(firstJson('```json\n{"same": true}\n```')).toEqual({ same: true });
    expect(firstJson("không có")).toBeNull();
    expect(firstJson("{hỏng")).toBeNull();
  });
  it("fakeExtract / fakeJudge như fake_llm", () => {
    const ex = fakeExtract("Dự án Apollo do Nguyen An phụ trách cùng Hanoi Team");
    expect(ex.entities.map((e) => `${e.type}:${e.name}`)).toContain("Concept:Apollo");
    expect(ex.entities.map((e) => `${e.type}:${e.name}`)).toContain("Person:Nguyen An");
    expect(fakeJudge(" a ", "a").verdict).toBe("DUPLICATE");
    expect(fakeJudge("a", "b").verdict).toBe("CONFLICT");
  });
  it("similarPairs: chỉ tài liệu khác, cosine ≥ ngưỡng, tốt nhất trước, ≤ k", () => {
    const a = {
      id: "a1",
      docId: "A",
      body: "thanh toán trong vòng 30 ngày kể từ ngày nhận hóa đơn",
    };
    const others = [
      { id: "b1", docId: "B", body: "thanh toan trong vong 30 ngay ke tu ngay nhan hoa don" },
      { id: "a2", docId: "A", body: a.body },
      { id: "c1", docId: "C", body: "giao hàng tại kho Long An" },
    ];
    const p = similarPairs([a], others, 0.5, 6);
    expect(p.map((x) => x.b)).toEqual(["b1"]);
    expect(p[0]?.score).toBeCloseTo(1, 5);
    expect(cosineSets(tokenSet("a b"), tokenSet(""))).toBe(0);
  });
  it("docProbeTerms: từ ≥ 4 ký tự tần suất cao, tất định", () => {
    expect(docProbeTerms(["thanh toán thanh toán hóa đơn", "thanh toán giao hàng"], 2)).toEqual([
      "thanh",
      "toan",
    ]);
  });
});
