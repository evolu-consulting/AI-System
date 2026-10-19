// M3 · D3-04 · ADR-0028: HĐ PDF không có `source_text` ⇒ chữ từ lớp chữ PDF đi vào lời nhắc có rào (agent nhận VĂN BẢN, không
// tệp) và vào kiểm trích dẫn; PDF scan ⇒ `extract_failed PDF_NEEDS_OCR` (agent không được gọi); ảnh ⇒ đường cũ. Không DB, không mạng.
import { describe, expect, it } from "bun:test";
import type { PdfConverter, PdfResult } from "../../kit/domain/pdf.rules";
import { createExtractionAgent } from "../adapters/extraction-agent";
import { createExtractionVerifier } from "../adapters/extraction-verifier";
import { pdfSourceText } from "../adapters/source-file-text";
import { fillFields } from "../domain/fields.rules";
import { createRunExtraction } from "./run-extraction.usecase";

const who = { tenantId: "t", userId: "u" };
const KEYS = Object.keys(fillFields({}));
const json = (quote: string) =>
  JSON.stringify({
    fields: Object.fromEntries(
      KEYS.map((k) => [
        k,
        k === "number" ? { value: "01/2026", quote } : { value: null, quote: "" },
      ]),
    ),
    items: [],
    clauses: [],
  });

function setup(mime: string, pdf: PdfResult) {
  const log: string[] = [];
  const row = { status: "extracting", version: 1, fields: {} as unknown };
  const repo = {
    source: async () => ({
      ...row,
      kind: "contract",
      text: null,
      file: { org: "t_t", fileId: "f1", mime },
      parent: null,
      items: [],
    }),
    saveResult: async (_id: string, r: { fields: unknown }) => {
      Object.assign(row, { status: "needs_review", version: 2, fields: r.fields });
      return true;
    },
    saveFailure: async (_id: string, code: string) => {
      log.push(`fail:${code}`);
      row.status = "extract_failed";
      return true;
    },
  };
  const uow = {
    tenant: async (_w: unknown, fn: (r: unknown) => Promise<unknown>) =>
      fn({ extraction: repo, outbox: { enqueue: async () => {} } }),
  };
  const calls: { text: string; file: boolean }[] = [];
  const agent = createExtractionAgent(async (req) => {
    calls.push({ text: req.prompt, file: req.file !== null });
    return req.file
      ? { ok: false, code: "AGENT_UNAVAILABLE" }
      : { ok: true, text: json("Số 01/2026") };
  });
  const converter: PdfConverter = { toText: async () => pdf };
  const fileText = pdfSourceText({
    files: () => ({ getContent: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) }),
    pdf: converter,
  });
  const run = createRunExtraction({
    uow: uow as never,
    agent,
    verifier: createExtractionVerifier(),
    tax: null,
    fileText,
  });
  return { run, log, row, calls };
}

describe("D3-04 · PDF hợp đồng", () => {
  it("PDF có lớp chữ ⇒ agent nhận văn bản (không tệp), trích dẫn kiểm trên chữ PDF ⇒ needs_review, verified", async () => {
    const s = setup("application/pdf", {
      ok: true,
      markdown: "HỢP ĐỒNG Số 01/2026 giữa hai bên",
      pages: 1,
      warnings: [],
    });
    expect(await s.run(who, "c")).toBe("needs_review");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.file).toBe(false);
    expect(s.calls[0]?.text).toContain("HỢP ĐỒNG Số 01/2026");
    expect(fillFields(s.row.fields).number).toMatchObject({ value: "01/2026", verified: true });
  });
  it("PDF scan ⇒ extract_failed PDF_NEEDS_OCR, agent KHÔNG được gọi", async () => {
    const s = setup("application/pdf", { ok: false, code: "PDF_NEEDS_OCR" });
    expect(await s.run(who, "c")).toBe("extract_failed");
    expect(s.log).toEqual(["fail:PDF_NEEDS_OCR"]);
    expect(s.calls).toHaveLength(0);
  });
  it("ảnh ⇒ không qua PDF, tệp tới agent như trước (AGENT_UNAVAILABLE)", async () => {
    const s = setup("image/png", { ok: false, code: "PDF_UNREADABLE" });
    expect(await s.run(who, "c")).toBe("extract_failed");
    expect(s.log).toEqual(["fail:AGENT_UNAVAILABLE"]);
    expect(s.calls.map((c) => c.file)).toEqual([true]);
  });
});
