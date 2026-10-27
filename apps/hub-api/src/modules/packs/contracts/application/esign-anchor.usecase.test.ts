// esign-anchor-fix · unit: xem trước dùng converter RIÊNG (bận ⇒ "unknown", lần gửi vẫn đọc được bằng converter của nó); chữ trích
// cache theo (tenant, file_id) ⇒ gọi dồn không tải/đọc PDF lại; schema cụm chặn ký tự điều khiển.
import { describe, expect, it } from "bun:test";
import { ESignAnchorsSchema } from "@ai/contracts";
import type { PdfResult } from "../../kit/domain/pdf.rules";
import { type ESignAnchorSource, esignAnchors } from "./esign-anchor.usecase";

const who = { tenantId: "t1", userId: "u1" };
const SIG = `${"Điều 1. ".repeat(200)}\n\nĐẠI DIỆN BÊN A      ĐẠI DIỆN BÊN B\n`;
const src: ESignAnchorSource = {
  deal: null,
  direction: "purchase",
  text: null,
  file: { org: "t_t1", fileId: "f1", mime: "application/pdf" },
};

function setup() {
  const n = { get: 0, send: 0, preview: 0 };
  const conv = (k: "send" | "preview", r: () => PdfResult) => ({
    toText: async () => {
      n[k] += 1;
      return r();
    },
  });
  let previewBusy = false;
  const u = esignAnchors({
    uow: {
      tenant: async (_w, fn) =>
        fn({
          anchor: { lists: async () => null, saveLists: async () => {}, source: async () => src },
        }),
    },
    files: () => ({
      getContent: async () => {
        n.get += 1;
        return new Uint8Array([1]);
      },
      postFile: async () => ({ fileId: "", versionId: "" }),
      getLink: async () => null,
      deleteFile: async () => null,
    }),
    pdf: conv("send", () => ({ ok: true, markdown: SIG, pages: 1, warnings: [] })),
    previewPdf: conv("preview", () =>
      previewBusy
        ? { ok: false, code: "PDF_BUSY" }
        : { ok: true, markdown: SIG, pages: 1, warnings: [] },
    ),
  });
  return { u, n, busy: (b: boolean) => (previewBusy = b) };
}

describe("esign-anchor-fix · xem trước tách converter + cache", () => {
  it("xem trước bận ⇒ 'unknown', không chạm converter gửi; gửi vẫn chọn được anchor", async () => {
    const s = setup();
    s.busy(true);
    expect(await s.u.preview(who, "c1")).toEqual({ placement: "unknown" });
    expect(s.n).toMatchObject({ preview: 1, send: 0 });
    const p = await s.u.pick(who, "c1", ["company", "partner"], new Uint8Array([1]));
    expect(p).toEqual({ mode: "text", anchors: ["ĐẠI DIỆN BÊN A", "ĐẠI DIỆN BÊN B"] });
    expect(s.n.send).toBe(1);
  });

  it("chữ trích cache theo file: xem trước gọi dồn + gửi chỉ tải/đọc PDF một lần", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) expect(await s.u.preview(who, "c1")).toEqual({ placement: "text" });
    expect((await s.u.pick(who, "c1", ["company", "partner"])).mode).toBe("text");
    expect(s.n).toEqual({ get: 1, send: 0, preview: 1 });
  });

  it("bận KHÔNG lưu cache (lần sau đọc lại)", async () => {
    const s = setup();
    s.busy(true);
    await s.u.preview(who, "c1");
    s.busy(false);
    expect(await s.u.preview(who, "c1")).toEqual({ placement: "text" });
    expect(s.n.preview).toBe(2);
  });
});

describe("esign-anchor-fix · schema cụm", () => {
  it("chặn ký tự điều khiển (\\u0000, \\u0007); xuống dòng gộp thành khoảng trắng", () => {
    expect(ESignAnchorsSchema.safeParse({ a: ["BÊN\u0000A"], b: ["BÊN B"] }).success).toBe(false);
    expect(ESignAnchorsSchema.safeParse({ a: ["BÊN A"], b: ["BÊN\u0007B"] }).success).toBe(false);
    expect(ESignAnchorsSchema.parse({ a: ["BÊN\nA"], b: ["BÊN B"] }).a).toEqual(["BÊN A"]);
  });
});
