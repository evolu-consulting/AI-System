// HD1 review vòng 1 (m-03, m-08): `starter.start` ném ĐỒNG BỘ/bất đồng bộ sau commit ⇒ vẫn 201, KHÔNG hoàn quota, KHÔNG xoá
// tệp, có log; DOCX nhận `{tenantId}` (hàng đợi công bằng N1).
import { describe, expect, test } from "bun:test";
import type { DocxRequestOpts } from "../../kit/domain/docx.rules";
import type { ExtractionStarter } from "./upload-contract.ports";
import { createUploadContract } from "./upload-contract.usecase";

const T = "00000000-0000-4000-8000-0000000000a1";
const U = "00000000-0000-4000-8000-0000000000b1";
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

function setup(starter: ExtractionStarter) {
  const log: string[] = [];
  const docxOpts: (DocxRequestOpts | undefined)[] = [];
  const run = createUploadContract({
    uow: {
      tenant: (_w, fn) =>
        fn({
          upload: {
            insert: async (r) => ({ id: r.id, status: r.status, version: 1 }),
            insertVersion: async () => {
              throw new Error("not used");
            },
          },
          outbox: { enqueue: async () => undefined },
        }) as never,
    },
    counter: {
      take: async () => ({ tenant: 1, global: 1 }),
      refund: async () => void log.push("refund"),
    },
    files: {
      put: async () => ({ fileId: "f1", versionId: "v1" }),
      remove: async () => void log.push("remove"),
    },
    docx: {
      toMarkdown: async (_b, o) => {
        docxOpts.push(o);
        return { ok: true, markdown: "# x", warnings: [] };
      },
    },
    starter,
    zipNames: () => ["word/document.xml"],
    limits: { tenant: 30, global: 300 },
    newId: () => "00000000-0000-7000-8000-000000000001",
    log: { warn: (m, f) => void log.push(`warn:${m}:${String(f?.contract_id)}`) },
  });
  const go = () =>
    run({
      who: { tenantId: T, userId: U },
      timeZone: "UTC",
      bytes: DOCX,
      name: "a.docx",
      title: "a",
      kind: "contract",
      parentId: null,
    });
  return { log, docxOpts, go };
}

const ID = "00000000-0000-7000-8000-000000000001";

describe("HD1 review · upload sau commit", () => {
  test("m-08 · starter ném ĐỒNG BỘ ⇒ trả HĐ, không hoàn quota, không xoá tệp, có log", async () => {
    const s = setup({
      start: () => {
        throw new Error("sync boom");
      },
    });
    expect((await s.go()).id).toBe(ID);
    expect(s.log).toEqual([`warn:contract-extraction-start-failed:${ID}`]);
  });
  test("m-08 · starter reject bất đồng bộ ⇒ như trên", async () => {
    const s = setup({ start: () => Promise.reject(new Error("async boom")) });
    expect((await s.go()).id).toBe(ID);
    expect(s.log).toEqual([`warn:contract-extraction-start-failed:${ID}`]);
  });
  test("m-03 · DOCX nhận {tenantId} của người tải", async () => {
    const s = setup({ start: async () => undefined });
    await s.go();
    expect(s.docxOpts).toEqual([{ tenantId: T }]);
    expect(s.log).toEqual([]);
  });
});
