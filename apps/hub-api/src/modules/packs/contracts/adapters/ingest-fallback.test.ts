// CR-122 p9 · FLOW2-FR-27: đường dự phòng đọc mọi định dạng — mỗi bước một test: (2) ảnh model nhận (WEBP/GIF) gửi thẳng,
// (3) tệp chữ lấy chữ, (4) zip-office lấy chữ, (5) định dạng còn lại báo rõ. Không DB/mạng.
import { describe, expect, it } from "bun:test";
import { unzipSync, zipSync } from "fflate";
import type { AiCallRequest, AiClient } from "../../../../lib/ai-client/ai-client";
import { sniffUpload } from "../application/upload-contract.usecase";
import { markupToText, plainText, rtfToText } from "../domain/text-formats.rules";
import { sniffFileType, unreadableFormat } from "../domain/upload.rules";
import { aiTransport, VISION_MIME } from "./ai-transport";
import { officeText } from "./office-text";

const enc = (s: string) => new TextEncoder().encode(s);
const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc(v)])));

describe("p9 bước 2 · ảnh model nhận gửi thẳng", () => {
  it("WEBP/GIF được nhận ra và nằm trong danh sách MIME đính kèm; transport đính tệp (không chuyển đổi)", async () => {
    expect(VISION_MIME).toEqual(expect.arrayContaining(["image/webp", "image/gif"]));
    const seen: AiCallRequest[] = [];
    const client = {
      ready: true,
      complete: async (r: AiCallRequest) => (
        seen.push(r), { ok: true, text: "{}", model: "m", usage: {} }
      ),
    } as unknown as AiClient;
    const t = aiTransport(client, {
      model: "m",
      files: () => ({ getContent: async () => enc("RIFFxxxxWEBP") }),
    });
    const base = {
      who: { tenantId: "t", userId: "u" },
      contractId: "c",
      system: "s",
      prompt: "p",
      signal: new AbortController().signal,
    };
    const r = await t({ ...base, file: { org: "o", fileId: "f", mime: "image/webp" } });
    expect(r.ok).toBe(true);
    expect(seen[0]?.attachments?.[0]?.mime).toBe("image/webp");
  });
  it("MIME model không nhận (HEIC…) ⇒ AGENT_UNAVAILABLE, không gọi AI", async () => {
    let called = 0;
    const client = { ready: true, complete: async () => void called++ } as unknown as AiClient;
    const t = aiTransport(client, {
      model: "m",
      files: () => ({ getContent: async () => enc("x") }),
    });
    const r = await t({
      who: { tenantId: "t", userId: "u" },
      contractId: "c",
      system: "s",
      prompt: "p",
      signal: new AbortController().signal,
      file: { org: "o", fileId: "f", mime: "image/heic" },
    });
    expect(r).toEqual({ ok: false, code: "AGENT_UNAVAILABLE" });
    expect(called).toBe(0);
  });
});

describe("p9 bước 3 · tệp chữ", () => {
  it("txt/csv/json nhận theo đuôi + UTF-8; html/xml bỏ thẻ + script; rtf bỏ lệnh điều khiển", () => {
    expect(plainText(enc("Điều 1\nBên A"), "a.txt")).toBe("Điều 1\nBên A");
    expect(plainText(enc("a,b\n1,2"), "x.CSV")).toBe("a,b\n1,2");
    expect(plainText(enc('{"so":"01/2026"}'), "a.json")).toContain("01/2026");
    const html =
      "<html><style>p{}</style><body><p>Hợp đồng &amp; phụ lục</p><script>x()</script><p>Điều 2</p></body></html>";
    expect(plainText(enc(html), "a.html")).toBe("Hợp đồng & phụ lục\nĐiều 2");
    expect(markupToText("<a>x</a>&#65;")).toBe("x A");
    expect(
      rtfToText("{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hop dong\\par Dieu 1 \\u7873? end}"),
    ).toContain("Hop dong\nDieu 1");
  });
  it("từ chối: đuôi lạ, rỗng, có NUL, UTF-8 hỏng; sniff ⇒ 'text'", () => {
    expect(plainText(enc("x"), "a.exe")).toBeNull();
    expect(plainText(new Uint8Array(), "a.txt")).toBeNull();
    expect(plainText(new Uint8Array([0x41, 0, 0x42]), "a.txt")).toBeNull();
    expect(plainText(new Uint8Array([0xff, 0xfe]), "a.txt")).toBeNull();
    expect(sniffUpload(enc("Điều 1"), () => [], "a.txt")).toBe("text");
  });
});

describe("p9 bước 4 · zip-office (xlsx, pptx, odt)", () => {
  it("nhận ra theo tên phần và lấy chữ", () => {
    const xlsx = zip({
      "xl/workbook.xml": "<w/>",
      "xl/sharedStrings.xml": "<sst><si><t>Đơn giá</t></si><si><t>Bê tông</t></si></sst>",
    });
    const pptx = zip({
      "ppt/presentation.xml": "<p/>",
      "ppt/slides/slide2.xml": "<a:p><a:t>Trang hai</a:t></a:p>",
      "ppt/slides/slide1.xml": "<a:p><a:t>Trang một</a:t></a:p>",
    });
    const odt = zip({
      mimetype: "application/vnd.oasis.opendocument.text",
      "content.xml": "<text:p>Điều 1</text:p><text:p>Điều 2</text:p>",
    });
    const nm = (b: Uint8Array) => Object.keys(unzipSync(b));
    expect(sniffFileType(xlsx, nm(xlsx))).toBe("office");
    expect(sniffFileType(pptx, nm(pptx))).toBe("office");
    expect(sniffFileType(odt, nm(odt))).toBe("office");
    expect(officeText(xlsx)).toBe("Đơn giá\nBê tông");
    expect(officeText(pptx)).toBe("Trang một\nTrang hai");
    expect(officeText(odt)).toBe("Điều 1\nĐiều 2");
  });
  it("zip hỏng hoặc không có chữ ⇒ null", () => {
    expect(officeText(enc("không phải zip"))).toBeNull();
    expect(officeText(zip({ "xl/sharedStrings.xml": "<sst/>" }))).toBeNull();
  });
});

describe("p9 bước 5 · còn lại báo rõ", () => {
  it("HEIC/TIFF/BMP/doc cũ ⇒ có tên định dạng để báo 'chưa đọc được — hãy lưu sang PDF hoặc JPG'; rác ⇒ null", () => {
    expect(unreadableFormat(new Uint8Array([0, 0, 0, 24, ...enc("ftypmif1"), 0, 0, 0, 0]))).toBe(
      "heic",
    );
    expect(unreadableFormat(new Uint8Array([0x49, 0x49, 0x2a, 0]))).toBe("tiff");
    expect(unreadableFormat(enc("BM...."))).toBe("bmp");
    expect(unreadableFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe("doc/xls/ppt");
    expect(unreadableFormat(enc("hello"))).toBeNull();
  });
});
