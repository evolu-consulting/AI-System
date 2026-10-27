// HD-FR-08 · D-06 · D-09 · plan §5: use case tải lên với cổng giả — thứ tự kiểm, hoàn quota, gỡ tệp, DOCX.
import { describe, expect, it } from "bun:test";
import type { DocxResult } from "../../kit/domain/docx.rules";
import {
  type NewUploadedContract,
  type UploadDays,
  UploadError,
  type UploadTxRepos,
} from "./upload-contract.ports";
import { createUploadContract, type UploadContractDeps } from "./upload-contract.usecase";

const T = "00000000-0000-4000-8000-0000000000a1";
const U = "00000000-0000-4000-8000-0000000000b1";
const enc = new TextEncoder();
const PDF = enc.encode("%PDF-1.4\nx");
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

type Opts = { counts?: [number, number]; take?: "throw"; docx?: DocxResult };
type St = {
  log: string[];
  inserted: NewUploadedContract[];
  failTx: Error | null;
  failPut: boolean;
};

function fakeRepos(st: St): UploadTxRepos {
  return {
    upload: {
      insert: async (r) => {
        if (st.failTx) throw st.failTx;
        st.inserted.push(r);
        return { id: r.id, status: r.status, version: 1 };
      },
      insertVersion: async () => {
        throw new Error("not used");
      },
    },
    outbox: { enqueue: async (rows) => void st.log.push(`outbox:${rows.length}`) },
  };
}

function fakeDeps(o: Opts, st: St): UploadContractDeps {
  let n = 0;
  const repos = fakeRepos(st);
  return {
    uow: { tenant: (_w, fn) => fn(repos) as never },
    counter: {
      take: async (_t, days: UploadDays) => {
        st.log.push(`take:${days.tenant}/${days.global}`);
        if (o.take === "throw") throw new Error("down");
        const [t, g] = o.counts ?? [1, 1];
        return { tenant: t, global: g };
      },
      refund: async () => void st.log.push("refund"),
    },
    files: {
      put: async (org) => {
        st.log.push(`put:${org}`);
        if (st.failPut) throw new Error("fb 503");
        return { fileId: "f1", versionId: "v1" };
      },
      remove: async (org, id) => void st.log.push(`remove:${org}:${id}`),
    },
    docx: { toMarkdown: async () => o.docx ?? { ok: true, markdown: "# Điều 1", warnings: [] } },
    starter: { start: async () => void st.log.push("start") },
    zipNames: () => ["word/document.xml"],
    limits: { tenant: 30, global: 300 },
    newId: () => `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`,
    now: () => new Date("2026-10-19T18:30:00Z"),
  };
}

function setup(o: Opts = {}) {
  const st: St = { log: [], inserted: [], failTx: null, failPut: false };
  const run = createUploadContract(fakeDeps(o, st));
  const input = (bytes: Uint8Array, extra: Partial<Parameters<typeof run>[0]> = {}) =>
    run({
      who: { tenantId: T, userId: U },
      timeZone: "Asia/Ho_Chi_Minh",
      bytes,
      name: "a.pdf",
      title: "a",
      kind: "contract",
      parentId: null,
      ...extra,
    });
  return { st, log: st.log, inserted: st.inserted, input };
}
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof UploadError ? e.code : String(e)),
  );

describe("upload-contract use case", () => {
  it("PDF ⇒ một lần take (ngày tenant theo múi, ngày toàn cục UTC), put org t_<tenant>, insert + outbox, start sau commit", async () => {
    const s = setup();
    const r = await s.input(PDF);
    expect(r.status).toBe("extracting");
    expect(s.log).toEqual(["take:2026-10-20/2026-10-19", `put:t_${T}`, "outbox:1", "start"]);
    expect(s.inserted[0]).toMatchObject({ mime: "application/pdf", sourceText: null, error: null });
    expect(Object.keys(s.inserted[0]?.fields ?? {})).toHaveLength(23);
  });
  it("magic bytes sai ⇒ FILE_TYPE; phụ lục mới ⇒ USE_VERSIONS (CR-101a); kind/parent lệch ⇒ PARENT_INVALID — trước quota", async () => {
    const s = setup();
    expect(await codeOf(s.input(enc.encode("MZ....")))).toBe("FILE_TYPE");
    expect(await codeOf(s.input(PDF, { kind: "appendix" }))).toBe("USE_VERSIONS");
    expect(await codeOf(s.input(PDF, { kind: "appendix", parentId: T }))).toBe("USE_VERSIONS");
    expect(await codeOf(s.input(PDF, { parentId: T }))).toBe("PARENT_INVALID");
    expect(s.log).toEqual([]);
  });
  it("vượt tenant ⇒ hoàn + UPLOAD_QUOTA {scope tenant, limit, resets_at = 00:00 ngày kế múi tenant}", async () => {
    const s = setup({ counts: [31, 31] });
    const e = await s.input(PDF).catch((x) => x as UploadError);
    expect(e).toBeInstanceOf(UploadError);
    expect((e as UploadError).details).toEqual({
      scope: "tenant",
      limit: 30,
      resets_at: "2026-10-20T17:00:00.000Z",
    });
    expect(s.log).toEqual(["take:2026-10-20/2026-10-19", "refund"]);
  });
});

describe("upload-contract use case · quota + hoàn tác", () => {
  it("vượt toàn cục ⇒ scope global, resets_at = 00:00 UTC ngày kế", async () => {
    const s = setup({ counts: [5, 301] });
    const e = (await s.input(PDF).catch((x) => x)) as UploadError;
    expect(e.details).toMatchObject({
      scope: "global",
      limit: 300,
      resets_at: "2026-10-20T00:00:00.000Z",
    });
  });
  it("Redis lỗi ⇒ UPLOAD_QUOTA_UNAVAILABLE, không put", async () => {
    const s = setup({ take: "throw" });
    expect(await codeOf(s.input(PDF))).toBe("UPLOAD_QUOTA_UNAVAILABLE");
    expect(s.log.some((l) => l.startsWith("put"))).toBe(false);
  });
  it("DOCX_BUSY ⇒ hoàn quota, không put; DOCX_UNREADABLE ⇒ lưu, extract_failed", async () => {
    const busy = setup({ docx: { ok: false, code: "DOCX_BUSY" } });
    expect(await codeOf(busy.input(ZIP))).toBe("DOCX_BUSY");
    expect(busy.log.slice(1)).toEqual(["refund"]);
    const bad = setup({ docx: { ok: false, code: "DOCX_UNREADABLE" } });
    expect(await bad.input(ZIP)).toMatchObject({ status: "extract_failed" });
    expect(bad.inserted[0]).toMatchObject({ error: "DOCX_UNREADABLE", sourceText: null });
    const ok = setup();
    await ok.input(ZIP);
    expect(ok.inserted[0]?.sourceText).toBe("# Điều 1");
  });
  it("FileBox lỗi ⇒ hoàn quota, không remove; tx lỗi ⇒ hoàn quota + gỡ tệp đã put", async () => {
    const a = setup();
    a.st.failPut = true;
    expect(await codeOf(a.input(PDF))).toBe("Error: fb 503");
    expect(a.log.slice(1)).toEqual([`put:t_${T}`, "refund"]);
    const b = setup();
    b.st.failTx = new UploadError("PARENT_INVALID");
    expect(await codeOf(b.input(PDF))).toBe("PARENT_INVALID");
    expect(b.log.slice(1)).toEqual([`put:t_${T}`, "refund", `remove:t_${T}:f1`]);
  });
});
