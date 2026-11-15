// CR-157b · M1 «Trích lại» khi đang ở lượt duyệt xoá đối chiếu · M3 sửa trường xoá đối chiếu · M5 đối chiếu chỉ khi AI đã đọc xong ·
// Q1 «Tải tệp khác» (thay tệp HĐ nháp đọc lỗi). DB thật, role gói thật, RLS theo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow, packTenantOnly } from "../../kit/public";
import { reconcileEntry } from "../application/manual-entry.usecase";
import { patchFields } from "../application/patch-fields.usecase";
import { createReplaceFile } from "../application/upload-contract.usecase";
import { approvalRepo } from "./approval.repo";
import { contractsRepos } from "./contracts.repo";
import { submissionsRepo } from "./submissions.repo";
import { uploadContractRepo } from "./upload-contract.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let creator = "";
let assignee = "";
let other = "";
let foreign = "";
let started = 0;
const who = (u: string, t = T) => ({ tenantId: t, userId: u });
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

async function contract(extra: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await o`insert into contracts.contracts ${o({ id, tenant_id: T, title: "HĐ CR-157b", created_by: creator, owner_user_id: assignee, status: "draft", extract_state: "ready", entry_source: "manual", source_text: "Điều 1", ...extra } as never)}`;
  return id;
}
const row = async (id: string) =>
  (
    await o<
      {
        extract_state: string;
        reconciled_by: string | null;
        reconciled_at: Date | null;
        file_id: string | null;
        version: number;
      }[]
    >`select extract_state, reconciled_by, reconciled_at, file_id, version from contracts.contracts where id = ${id}`
  )[0];
const reconciled = () => ({ reconciled_by: creator, reconciled_at: new Date() });

const replaceUc = () =>
  createReplaceFile({
    uow: packTenantOnly(
      createPackUow(
        db,
        "contracts",
        (tx, tid) => ({ upload: uploadContractRepo(tx, tid) }) as never,
      ),
    ) as never,
    counter: {
      take: async () => ({ tenant: 1, global: 1 }),
      refund: async () => undefined,
    } as never,
    limits: { tenant: 100, global: 100 },
    files: {
      put: async () => ({ fileId: "f-new", versionId: "v-new" }),
      remove: async () => undefined,
    },
    docx: { toMarkdown: async () => ({ ok: false, code: "DOCX_UNREADABLE" }) } as never,
    starter: {
      start: async () => {
        started += 1;
      },
    },
    zipNames: () => [],
    newId: () => crypto.randomUUID(),
  });
const replace = (u: string, id: string, t = T) =>
  replaceUc()({ who: who(u, t), id, timeZone: "Asia/Ho_Chi_Minh", bytes: PDF, name: "moi.pdf" });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9487)) as [string, string];
  [creator, assignee, other] = (await users(o, T, 3, { from: 9487 })) as [string, string, string];
  [foreign] = (await users(o, T2, 1, { from: 9500 })) as [string];
}, 120_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-157b đối chiếu bị xoá khi dữ liệu có thể đổi", () => {
  it("Trích lại khi HĐ đang ở lượt duyệt ⇒ xoá reconciled_by và reconciled_at", async () => {
    const id = await contract({ status: "processing", ...reconciled() });
    const runId = crypto.randomUUID();
    await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by) values (${runId}, ${T}, ${id}, 'level1', ${creator})`;
    await o`update contracts.contracts set run_id = ${runId} where id = ${id}`;
    const uow = packTenantOnly(
      createPackUow(db, "contracts", (tx, tid) => ({ ap: approvalRepo(tx, tid) })),
    );
    const ok = await uow.tenant(who(creator), (r) => r.ap.markExtracting(id, runId));
    expect(ok).toBe(true);
    expect(await row(id)).toMatchObject({
      extract_state: "reading",
      reconciled_by: null,
      reconciled_at: null,
    });
  });

  it("sửa trường HĐ manual đã đối chiếu ⇒ xoá đối chiếu, phải tích lại", async () => {
    const id = await contract({ ...reconciled() });
    const run = patchFields({
      uow: packTenantOnly(createPackUow(db, "contracts", contractsRepos)),
    });
    const out = await run(who(creator), id, { version: 1, fields: { notice_days: 45 } });
    expect(out.kind).toBe("ok");
    expect(await row(id)).toMatchObject({ reconciled_by: null, reconciled_at: null });
  });
});

describe("CR-157b đối chiếu chỉ khi AI đã đọc xong", () => {
  it("extract_state khác ready (đang đọc hoặc lỗi) ⇒ MANUAL_NOT_ALLOWED, không ghi", async () => {
    const uow = packTenantOnly(
      createPackUow(db, "contracts", (tx, tid) => ({ sub: submissionsRepo(tx, tid) })),
    );
    for (const st of ["reading", "failed"]) {
      const id = await contract({ extract_state: st });
      const out = await reconcileEntry({ uow: uow as never })(who(creator), id, true);
      expect([st, out]).toEqual([st, { error: "MANUAL_NOT_ALLOWED" }]);
      expect((await row(id))?.reconciled_by).toBeNull();
    }
  });
});

describe("CR-157b Tải tệp khác", () => {
  it("DRAFT + failed, người được giao (không phải người tạo) ⇒ thay tệp, AI đọc lại, bỏ đối chiếu", async () => {
    const id = await contract({
      extract_state: "failed",
      error: "PDF_UNREADABLE",
      ...reconciled(),
    });
    const before = await row(id);
    started = 0;
    const out = await replace(assignee, id);
    expect(out).toMatchObject({ extractState: "reading" });
    expect(started).toBe(1);
    const after = await row(id);
    expect(after).toMatchObject({
      extract_state: "reading",
      reconciled_by: null,
      reconciled_at: null,
    });
    expect(after?.file_id).not.toBe(before?.file_id);
    expect(after?.version).toBe((before?.version ?? 0) + 1);
  });

  it("người ngoài ⇒ FORBIDDEN, tenant khác ⇒ NOT_FOUND, không ghi", async () => {
    const id = await contract({ extract_state: "failed" });
    await expect(replace(other, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(replace(foreign, id, T2)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await row(id))?.extract_state).toBe("failed");
  });

  it("sai trạng thái (đang đọc, đã đọc xong, không còn nháp) ⇒ REPLACE_NOT_ALLOWED", async () => {
    const cases = [
      { extract_state: "reading" },
      { extract_state: "ready" },
      { extract_state: "failed", status: "done" },
    ];
    for (const extra of cases) {
      const id = await contract(extra);
      await expect(replace(creator, id)).rejects.toMatchObject({ code: "REPLACE_NOT_ALLOWED" });
    }
  });
});
