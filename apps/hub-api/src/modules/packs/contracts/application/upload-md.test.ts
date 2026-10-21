// Gap #9: tải lên Markdown — chỉ nhận `.md`/`.markdown` có nội dung UTF-8 thuần (không NUL); tệp nhị phân đổi tên không lọt.
import { describe, expect, it } from "bun:test";
import { markdownText } from "../domain/upload.rules";
import { sniffUpload } from "./upload-contract.usecase";

const enc = (s: string) => new TextEncoder().encode(s);
const noZip = () => [];

describe("Gap #9 · markdown", () => {
  it("nhận .md / .markdown (không phân biệt hoa thường), bỏ BOM", () => {
    expect(markdownText(enc("\uFEFF# Điều 1"), "HD.MD")).toBe("# Điều 1");
    expect(sniffUpload(enc("# Điều 1\n"), noZip, "a.md")).toBe("md");
    expect(sniffUpload(enc("# x"), noZip, "a.markdown")).toBe("md");
  });
  it("từ chối: sai đuôi, rỗng, có byte NUL, UTF-8 hỏng", () => {
    expect(sniffUpload(enc("# x"), noZip, "a.txt")).toBeNull();
    expect(sniffUpload(enc("# x"), noZip)).toBeNull();
    expect(markdownText(new Uint8Array(), "a.md")).toBeNull();
    expect(markdownText(new Uint8Array([0x23, 0x00, 0x41]), "a.md")).toBeNull();
    expect(markdownText(new Uint8Array([0xff, 0xfe, 0xfd]), "a.md")).toBeNull();
  });
  it("PDF đổi tên .md vẫn là pdf (chữ ký thắng)", () => {
    expect(sniffUpload(enc("%PDF-1.7 abc"), noZip, "a.md")).toBe("pdf");
  });
});
