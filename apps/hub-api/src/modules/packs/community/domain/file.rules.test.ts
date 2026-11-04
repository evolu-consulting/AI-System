// CR-118 · cr118-community-files · §11.1: luật thuần tệp bài (sniff không tin đuôi, tên an toàn, header tải về).
import { describe, expect, it } from "bun:test";
import { ATTACH_ALLOWED } from "@ai/contracts";
import {
  contentDisposition,
  downloadHeaders,
  mediaKindOf,
  safeFileName,
  sniffMime,
} from "./file.rules";

const enc = new TextEncoder();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MZ = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

describe("sniffMime [CR-118]", () => {
  it("nội dung khớp đuôi ⇒ mime cho phép", () => {
    expect(sniffMime("a.pdf", enc.encode("%PDF-1.7\n"), ATTACH_ALLOWED)).toBe("application/pdf");
    expect(sniffMime("A.PNG", PNG, ATTACH_ALLOWED)).toBe("image/png");
    expect(sniffMime("bang.csv", enc.encode("ma,gia\nA,1\n"), ATTACH_ALLOWED)).toBe("text/csv");
    expect(sniffMime("d.docx", new Uint8Array([0x50, 0x4b, 3, 4, 0]), ATTACH_ALLOWED)).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("đội lốt / chạy được / markup / đuôi lạ / rỗng ⇒ null", () => {
    expect(sniffMime("a.pdf", MZ, ATTACH_ALLOWED)).toBeNull();
    expect(
      sniffMime("a.pdf", enc.encode("<html><body>x</body></html>"), ATTACH_ALLOWED),
    ).toBeNull();
    expect(sniffMime("a.png", enc.encode("%PDF-1.7"), ATTACH_ALLOWED)).toBeNull();
    expect(sniffMime("a.txt", enc.encode("#!/bin/sh\nrm -rf /"), ATTACH_ALLOWED)).toBeNull();
    expect(
      sniffMime("a.txt", enc.encode("hi <script>alert(1)</script>"), ATTACH_ALLOWED),
    ).toBeNull();
    expect(
      sniffMime("a.xml", enc.encode('<?xml version="1.0"?><svg onload="x"/>'), ATTACH_ALLOWED),
    ).toBeNull();
    expect(sniffMime("a.txt", new Uint8Array([0x68, 0, 0x69]), ATTACH_ALLOWED)).toBeNull();
    expect(sniffMime("a.txt", new Uint8Array([0xc3, 0x28]), ATTACH_ALLOWED)).toBeNull();
    expect(sniffMime("a.exe", MZ, ATTACH_ALLOWED)).toBeNull();
    expect(sniffMime("README", enc.encode("x"), ATTACH_ALLOWED)).toBeNull();
    expect(sniffMime("a.pdf", new Uint8Array(), ATTACH_ALLOWED)).toBeNull();
  });
});

describe("safeFileName / header [CR-118]", () => {
  it("bỏ đường dẫn, ký tự bidi/điều khiển, chấm đầu cuối; dài ⇒ cắt giữ đuôi", () => {
    expect(safeFileName("../../Hợp đồng\u202e.pdf")).toBe("Hợp đồng.pdf");
    expect(safeFileName("C:\\x\\..")).toBe("file");
    const long = safeFileName(`${"a".repeat(300)}.pdf`);
    expect(long.length).toBe(200);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("ảnh inline, còn lại attachment; nosniff + CSP sandbox", () => {
    expect(mediaKindOf("image/png")).toBe("image");
    expect(mediaKindOf("application/pdf")).toBe("file");
    expect(contentDisposition("ảnh.png", "image/png")).toStartWith("inline;");
    const h = downloadHeaders({ name: 'b"g.pdf', mime: "application/pdf", size: 3 });
    expect(h["Content-Disposition"]).toBe(
      `attachment; filename="b_g.pdf"; filename*=UTF-8''b%22g.pdf`,
    );
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toContain("sandbox");
  });
});
