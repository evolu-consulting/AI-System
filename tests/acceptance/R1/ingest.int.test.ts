// R1 · N4-FR-02 · nạp tài liệu kiểu mgmt-app trên DB thật: DOCX mẫu (worker ADR-0024) ⇒ hợp đồng chia theo "Điều N"; PDF lớp chữ
// (worker ADR-0028) ⇒ tìm được; PDF scan ⇒ PDF_NEEDS_OCR; đuôi lạ ⇒ FORMAT_UNSUPPORTED; nạp lại ⇒ duplicate. Đồ thị (G1) với AI
// giả: thực thể + MENTIONS, bí danh ("An Nguyễn" ≡ "Nguyễn An"), LINKS_TO theo `uri`, SIMILAR + CONFLICTS giữa hai bản ghi chú
// lệch số; tenant khác không thấy gì.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { fakeGraphAi } from "../../../apps/hub-api/src/modules/knowledge/adapters/graph-ai.adapters";
import {
  fileConverters,
  ingestService,
  knowledgeService,
} from "../../../apps/hub-api/src/modules/knowledge/knowledge.mount";
import { makePdf } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pdf/pdf.fixture.test-util";

const A = tenantId(985);
const B = tenantId(986);
const U = userId(985);
const who = { tenantId: A, userId: U };
const DOCX = join(
  import.meta.dir,
  "../../../reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx",
);
const enc = (s: string) => new TextEncoder().encode(s);
const NOTE_A =
  "# Dự án Apollo\nNguyễn An phụ trách dự án Apollo. Hạn bàn giao kho Long An là ngày 15 tháng 11, ngân sách 200 triệu đồng.\n[Wiki](https://wiki.local/apollo)";
const NOTE_B =
  "# Dự án Apollo (bản cập nhật)\nAn Nguyễn phụ trách dự án Apollo. Hạn bàn giao kho Long An là ngày 30 tháng 11, ngân sách 200 triệu đồng.";

let db: Db;
let owner: Sql;
let files: ReturnType<typeof fileConverters>;
let ingest: ReturnType<typeof ingestService>;

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(1);
  db = createDb(urls().hubApi, { max: 2 });
  files = fileConverters();
  const env = { APP_ENV: "test" };
  ingest = ingestService(db, { env, graphAi: fakeGraphAi(), files });
});
afterAll(async () => {
  await files?.close();
  await db?.close();
  await owner?.end({ timeout: 2 });
});

const ok = <T>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
  if (!r.ok) throw new Error(r.code);
  return r.value;
};

describe("R1 · nạp tệp", () => {
  it("DOCX mẫu mgmt-app ⇒ hợp đồng, đoạn theo 'Điều N', tìm được nội dung", async () => {
    const out = ok(
      await ingest(who, {
        filename: "HD-bao-bi-Minh-Phat.docx",
        bytes: new Uint8Array(await Bun.file(DOCX).arrayBuffer()),
      }),
    );
    expect(out).toMatchObject({ format: "docx", kind: "contract", duplicate: false });
    expect(out.chunks).toBeGreaterThan(2);
    const [c] = await owner<{ n: number }[]>`
      select count(*)::int as n from knowledge.chunks where doc_id = ${out.documentId}::uuid and clause_no ~ '^[0-9]+$'`;
    expect(c?.n).toBeGreaterThan(0);
    const again = ok(
      await ingest(who, {
        filename: "copy.docx",
        bytes: new Uint8Array(await Bun.file(DOCX).arrayBuffer()),
      }),
    );
    expect(again).toMatchObject({ documentId: out.documentId, duplicate: true, graph: null });
  });

  it("PDF lớp chữ ⇒ nạp + tìm được; PDF scan ⇒ PDF_NEEDS_OCR; đuôi lạ ⇒ FORMAT_UNSUPPORTED; rỗng ⇒ FILE_EMPTY", async () => {
    const pdf = makePdf([
      ["Bien ban nghiem thu kho Binh Duong: dien tich 1200 m2, ban giao ngay 05/12/2026."],
    ]);
    const out = ok(await ingest(who, { filename: "nghiem-thu.pdf", bytes: pdf }));
    expect(out).toMatchObject({ format: "pdf", kind: "markdown" });
    const s = await knowledgeService(db, {
      env: {},
      ai: { embedder: null, reranker: null },
      sources: [],
    }).search(who, {
      query: "nghiem thu kho Binh Duong",
      k: 3,
    });
    expect(s.ok && s.value.hits[0]?.docId).toBe(out.documentId);
    expect(await ingest(who, { filename: "scan.pdf", bytes: makePdf([[], []]) })).toEqual({
      ok: false,
      code: "PDF_NEEDS_OCR",
    });
    expect(await ingest(who, { filename: "a.xlsx", bytes: enc("x") })).toEqual({
      ok: false,
      code: "FORMAT_UNSUPPORTED",
    });
    expect(await ingest(who, { filename: "a.md", bytes: new Uint8Array() })).toEqual({
      ok: false,
      code: "FILE_EMPTY",
    });
  });

  it("đồ thị: thực thể + bí danh + LINKS_TO + SIMILAR/CONFLICTS (AI giả); tenant B không thấy", async () => {
    const wiki = ok(
      await ingest(who, {
        filename: "apollo-wiki.md",
        bytes: enc("# Apollo wiki\nTrang wiki dự án."),
        uri: "https://wiki.local/apollo",
      }),
    );
    const a = ok(await ingest(who, { filename: "apollo-a.md", bytes: enc(NOTE_A) }));
    const b = ok(await ingest(who, { filename: "apollo-b.md", bytes: enc(NOTE_B) }));
    expect(a.graph?.entities).toBeGreaterThan(0);
    expect(a.graph?.docLinks).toBe(1);
    // B lệch A ở hạn bàn giao (15 ⇄ 30/11): một cặp SIMILAR + AI giả phán CONFLICTS; "An Nguyễn" ≡ "Nguyễn An"
    const g = b.graph ?? { similar: 0, conflicts: 0, aliases: 0 };
    expect([g.similar, g.conflicts, g.aliases]).toEqual([1, 1, 1]);
    const [dl] = await owner<
      { n: number }[]
    >`select count(*)::int as n from knowledge.document_links
      where src_id = ${a.documentId}::uuid and dst_id = ${wiki.documentId}::uuid`;
    expect(dl?.n).toBe(1);
    const kinds = await owner<{ kind: string }[]>`select distinct kind from knowledge.chunk_links
      where tenant_id = ${A}::uuid and (src_doc_id = ${b.documentId}::uuid or dst_doc_id = ${b.documentId}::uuid) order by 1`;
    expect(kinds.map((k) => k.kind)).toEqual(["CONFLICTS", "SIMILAR"]);
    const [al] = await owner<
      { n: number }[]
    >`select count(*)::int as n from knowledge.entity_aliases where tenant_id = ${A}::uuid`;
    expect(al?.n).toBeGreaterThan(0);
    const [leak] = await owner<{ n: number }[]>`
      select (select count(*) from knowledge.entities where tenant_id = ${B}::uuid)
        + (select count(*) from knowledge.chunk_links where tenant_id = ${B}::uuid) as n`;
    expect(Number(leak?.n)).toBe(0);
  });
});
