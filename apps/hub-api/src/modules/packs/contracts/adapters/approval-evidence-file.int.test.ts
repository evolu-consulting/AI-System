// CR-127 · E4b · BR-26 · int (DB thật, pool hub_api): tải tệp/chữ ký của bằng chứng duyệt. Byte chỉ cấp khi (1) tệp là chữ ký/tệp của CHÍNH
// bằng chứng (qua `hub.evidence_get`, đúng tenant) và (2) gói cho phép xem (`canReadEvidence`: người gửi/phụ trách/quản trị/người trong quy trình).
// Người chỉ xem, công ty khác, tệp không thuộc bằng chứng ⇒ null (route trả 404). Kho tệp giả; hồ sơ duyệt (state/decisions) giả theo HĐ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { extractText, getDocumentProxy } from "unpdf";
import { evidenceFileBytesOf, evidenceFileNamesOf } from "../../../attachments/public";
import { approvalEvidenceFile, approvalRecordPdf } from "../application/approval-record.usecase";
import type { RecordRow } from "../domain/approval-record.rules";

let o: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let SENDER = "";
let VIEWER = "";
let OTHER = "";
let EV = "";
let SIG = "";
let FILE = "";
let STRAY = "";
const CONTRACT = "0c127000-0000-4000-8000-0000000000c1";
const BYTES = new TextEncoder().encode("%PDF-1.4 bang chung\n%%EOF\n");

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T1, T2] = (await tenants(o, 2, 1277)) as [string, string];
  [SENDER, VIEWER] = (await users(o, T1, 2, { from: 1277 })) as [string, string];
  [OTHER] = (await users(o, T2, 1, { from: 1287 })) as [string];
  const mk = async (name: string) => {
    const id = crypto.randomUUID();
    await o`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
      values (${id}, ${T1}, ${SENDER}, 'upload', ${name}, ${name}, 'application/pdf', ${BYTES.length}, ${"b".repeat(64)}, ${`${T1}/${id}`})`;
    return id;
  };
  [SIG, FILE, STRAY] = [await mk("ky.pdf"), await mk("tep.pdf"), await mk("khac.pdf")];
  EV = crypto.randomUUID();
  await o.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.evidence (id, tenant_id, subject_kind, subject_id, note, signature_attachment_id, attachment_ids, by_user)
      values (${EV}, ${T1}, 'task_decision', ${crypto.randomUUID()}, 'Dong y', ${SIG}, ${[FILE]}::uuid[], ${SENDER})`;
  });
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const bytesOf = () => evidenceFileBytesOf(db, { blob: async () => new Blob([BYTES]) } as never);

/** Hồ sơ duyệt giả của HĐ thuộc T1: người gửi SENDER, không ai khác trong quy trình; HĐ ở công ty khác ⇒ không thấy. */
function deps(admin = false) {
  const row: RecordRow = {
    taskId: "t1",
    stage: "s0",
    action: "approve",
    at: "2026-11-10T01:00:00.000Z",
    actor: SENDER,
    feedback: null,
    evidence: {
      id: EV,
      note: "Dong y",
      signature_attachment_id: SIG,
      attachment_ids: [FILE],
      by_user: SENDER,
      on_behalf_of: null,
      at: "2026-11-10T01:00:00.000Z",
    },
  };
  return {
    port: () => undefined,
    isAdmin: async () => admin,
    evidenceBytes: bytesOf(),
    evidenceNames: evidenceFileNamesOf(db),
    uow: {
      tenant: async (who: { tenantId: string }, fn: (r: unknown) => Promise<unknown>) => {
        const seen = who.tenantId === T1;
        return fn({
          approval: {
            state: async (id: string) =>
              seen && id === CONTRACT
                ? { owner: null, approval: { startedBy: SENDER, engineRunId: null } }
                : null,
          },
          approvalEngine: {
            decisionsOf: async () => (seen ? [row] : []),
            labels: async () =>
              seen ? [{ id: CONTRACT, number: "HD-127", title: "Hợp đồng mua bán nội thất" }] : [],
          },
        });
      },
    },
  } as never;
}
const usecase = (admin = false) => approvalEvidenceFile(deps(admin));

describe("CR-127 E4b · evidenceFileBytesOf (hub)", () => {
  it("cấp byte chữ ký + tệp của đúng bằng chứng; tệp không thuộc bằng chứng / công ty khác / id lạ ⇒ null", async () => {
    const read = bytesOf();
    expect((await read(T1, EV, SIG))?.bytes.length).toBe(BYTES.length);
    expect((await read(T1, EV, FILE))?.name).toBe("tep.pdf");
    expect(await read(T1, EV, STRAY)).toBeNull(); // cùng công ty nhưng không thuộc bằng chứng này
    expect(await read(T2, EV, FILE)).toBeNull(); // công ty khác
    expect(await read(T1, crypto.randomUUID(), FILE)).toBeNull();
    expect(await read(T1, "khong-phai-uuid", FILE)).toBeNull();
  });
});

describe("CR-127 E4b · GET approval-record/evidence/:evidenceId/files/:fileId (use case)", () => {
  it("người gửi tải được tệp và chữ ký; quản trị công ty tải được", async () => {
    const who = { tenantId: T1, userId: SENDER };
    expect((await usecase()(who, CONTRACT, EV, FILE))?.bytes.length).toBe(BYTES.length);
    expect((await usecase()(who, CONTRACT, EV, SIG))?.name).toBe("ky.pdf");
    expect(
      await usecase(true)({ tenantId: T1, userId: VIEWER }, CONTRACT, EV, FILE),
    ).not.toBeNull();
  });

  it("người chỉ xem ⇒ null (404, không lộ tồn tại)", async () => {
    expect(await usecase()({ tenantId: T1, userId: VIEWER }, CONTRACT, EV, FILE)).toBeNull();
  });

  it("công ty khác ⇒ null; HĐ không có / bằng chứng của HĐ khác ⇒ null", async () => {
    expect(await usecase(true)({ tenantId: T2, userId: OTHER }, CONTRACT, EV, FILE)).toBeNull();
    const who = { tenantId: T1, userId: SENDER };
    expect(await usecase()(who, crypto.randomUUID(), EV, FILE)).toBeNull();
    expect(await usecase()(who, CONTRACT, crypto.randomUUID(), FILE)).toBeNull();
  });

  it("tệp không thuộc bằng chứng đó (kể cả cùng công ty) ⇒ null", async () => {
    expect(await usecase()({ tenantId: T1, userId: SENDER }, CONTRACT, EV, STRAY)).toBeNull();
  });
});

const textOf = async (b: Uint8Array) =>
  (await extractText(await getDocumentProxy(new Uint8Array(b)), { mergePages: true })).text;

describe("CR-127 U4b-3 · approvalRecordPdf (use case)", () => {
  const pdf = (admin = false) =>
    approvalRecordPdf(deps(admin), () => new Date("2026-11-11T02:00:00Z"));

  it("người gửi tải được PDF: có tên HĐ, ghi chú, tên tệp bằng chứng, chữ ký 'co'", async () => {
    const f = await pdf()({ tenantId: T1, userId: SENDER }, CONTRACT);
    expect(f?.name).toBe("ho-so-duyet-HD-127.pdf");
    expect(new TextDecoder().decode((f?.bytes ?? new Uint8Array()).slice(0, 5))).toBe("%PDF-");
    const t = await textOf(f?.bytes as Uint8Array);
    expect(t).toContain("Hợp đồng mua bán nội thất");
    expect(t).toContain("tep.pdf");
    expect(t).toContain("Dong y");
    expect(t).toMatch(/Chữ ký: có/);
  });

  it("người chỉ xem: PDF KHÔNG lộ ý kiến/tên tệp (BR-26) và ghi chú 'chỉ xem'", async () => {
    const f = await pdf()({ tenantId: T1, userId: VIEWER }, CONTRACT);
    const t = await textOf(f?.bytes as Uint8Array);
    expect(t).toContain("Hợp đồng mua bán nội thất");
    expect(t).not.toContain("tep.pdf");
    expect(t).not.toContain("Dong y");
    expect(t).toContain("Bản chỉ xem");
  });

  it("công ty khác / HĐ không có ⇒ null (404)", async () => {
    expect(await pdf(true)({ tenantId: T2, userId: OTHER }, CONTRACT)).toBeNull();
    expect(await pdf()({ tenantId: T1, userId: SENDER }, crypto.randomUUID())).toBeNull();
  });
});
