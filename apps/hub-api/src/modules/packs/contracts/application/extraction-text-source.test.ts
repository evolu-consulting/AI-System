// CR-122 p9b · hồi quy đường đọc: HĐ đã có `source_text` (Markdown/DOCX/tệp chữ/zip-office) đi đường VĂN BẢN như trước p9 —
// không gọi lấy chữ PDF, không đính tệp, agent nhận chữ và kết quả vào "needs_review". (Journey G1.2 tải `.md`.) Không DB, không mạng.
import { describe, expect, it } from "bun:test";
import { createExtractionAgent } from "../adapters/extraction-agent";
import { createExtractionVerifier } from "../adapters/extraction-verifier";
import { fillFields } from "../domain/fields.rules";
import { createRunExtraction } from "./run-extraction.usecase";

const who = { tenantId: "t", userId: "u" };
const KEYS = Object.keys(fillFields({}));
const json = JSON.stringify({
  fields: Object.fromEntries(KEYS.map((k) => [k, { value: null, quote: "" }])),
  items: [],
  clauses: [],
});

function setup(source: {
  text: string | null;
  file: { org: string; fileId: string; mime: string } | null;
}) {
  const row = { status: "draft", extractState: "reading", version: 1, fields: {} as unknown };
  const repo = {
    source: async () => ({ ...row, kind: "contract", parent: null, items: [], ...source }),
    saveResult: async () => {
      row.status = "needs_review";
      return true;
    },
    saveFailure: async (_id: string, code: string) => {
      row.status = `failed:${code}`;
      return true;
    },
  };
  const uow = {
    tenant: async (_w: unknown, fn: (r: unknown) => Promise<unknown>) =>
      fn({ extraction: repo, outbox: { enqueue: async () => {} } }),
  };
  const seen: { prompt: string; file: boolean }[] = [];
  let fileTextCalls = 0;
  const run = createRunExtraction({
    uow: uow as never,
    agent: createExtractionAgent(async (req) => {
      seen.push({ prompt: req.prompt, file: req.file !== null });
      return { ok: true, text: json };
    }),
    verifier: createExtractionVerifier(),
    tax: null,
    fileText: async () => {
      fileTextCalls++;
      return { ok: true, text: null, pages: 3 };
    },
  });
  return { run, row, seen, fileTextCalls: () => fileTextCalls };
}

describe("p9b · hồi quy: HĐ có source_text đi đường văn bản", () => {
  it("Markdown (có tệp gốc .md) ⇒ không lấy chữ PDF, không đính tệp, agent nhận chữ ⇒ needs_review", async () => {
    const s = setup({
      text: "Hợp đồng mua văn phòng phẩm số E2E-1/HĐMB",
      file: { org: "t_t", fileId: "f1", mime: "text/markdown" },
    });
    expect(await s.run(who, "c")).toBe("needs_review");
    expect(s.fileTextCalls()).toBe(0);
    expect(s.seen).toHaveLength(1);
    expect(s.seen[0]?.file).toBe(false);
    expect(s.seen[0]?.prompt).toContain("E2E-1/HĐMB");
  });
  it("tệp chữ/office (text/plain, application/zip) có source_text ⇒ cùng đường văn bản", async () => {
    for (const mime of ["text/plain", "application/zip"]) {
      const s = setup({
        text: "Điều 1. Bên A bán cho bên B",
        file: { org: "t_t", fileId: "f", mime },
      });
      expect(await s.run(who, "c")).toBe("needs_review");
      expect(s.fileTextCalls()).toBe(0);
      expect(s.seen[0]?.file).toBe(false);
    }
  });
});
