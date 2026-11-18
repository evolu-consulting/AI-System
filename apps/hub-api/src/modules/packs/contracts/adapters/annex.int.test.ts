// CR-182 · R6 «Thêm phụ lục cần ký» (use case tải lên thật + repo thật + pool hub_api + RLS gói): câu `annexInherit` chạy SQL thật.
// Từ chối ⇒ PARENT_INVALID + ROLLBACK (không còn hàng phụ lục) + tệp đã đẩy bị gỡ + quota hoàn. Đúng ⇒ kế thừa hướng + đối tác/loại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, enablePack, members, tenants, users, visibility } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow, packTenantOnly } from "../../kit/public";
import { UploadError } from "../application/upload-contract.ports";
import { createUploadContract } from "../application/upload-contract.usecase";
import { uploadContractRepo } from "./upload-contract.repo";

let sql: Sql;
let db: Db;
let A = "";
let B = "";
let creator = "";
let owner = "";
let viewer = "";
let admin = "";
let foreign = "";
let cDone = "";
let cDraft = "";
let cAppx = "";
let cOther = "";
const log: string[] = [];
const PDF = new TextEncoder().encode("%PDF-1.4\nphu luc");

const uc = () =>
  createUploadContract({
    uow: packTenantOnly(
      createPackUow(db, "contracts", (tx, t) => ({ upload: uploadContractRepo(tx, t) })),
    ) as never,
    counter: {
      take: async () => ({ tenant: 1, global: 1 }),
      refund: async () => void log.push("refund"),
    },
    files: {
      put: async () => {
        log.push("put");
        return { fileId: `fb-${Bun.randomUUIDv7()}`, versionId: "v1" };
      },
      remove: async () => void log.push("remove"),
    },
    docx: { toMarkdown: async () => ({ ok: true, markdown: "", warnings: [] }) },
    starter: { start: async () => undefined },
    zipNames: () => [],
    limits: { tenant: 100, global: 1000 },
    newId: () => Bun.randomUUIDv7(),
  } as never);

const annex = (tenant: string, user: string, parent: string, isAdmin = false) =>
  uc()({
    who: { tenantId: tenant, userId: user },
    timeZone: "Asia/Ho_Chi_Minh",
    bytes: PDF,
    name: "phu-luc.pdf",
    title: "Phụ lục 1",
    kind: "appendix",
    parentId: parent,
    annex: true,
    annexAdmin: isAdmin,
  });
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof UploadError ? e.code : String(e)),
  );
const appendixCount = async () =>
  Number(
    (await sql`select count(*)::int as n from contracts.contracts where kind = 'appendix'`)[0]?.n,
  );

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 901)) as [string, string];
  [creator, owner, viewer, admin] = (await users(sql, A, 4, { from: 901 })) as [
    string,
    string,
    string,
    string,
  ];
  [foreign] = (await users(sql, B, 1, { from: 910 })) as [string];
  const roles = await enablePack(sql, [A, B], "contracts");
  await members(sql, A, roles.get(A)?.editor as string, [creator, owner]);
  await members(sql, A, roles.get(A)?.viewer as string, [viewer]);
  await members(sql, A, roles.get(A)?.owner as string, [admin]);
  await members(sql, B, roles.get(B)?.editor as string, [foreign]);
  [cDone] = (await contracts(sql, A, 1, { from: 901, createdBy: creator, owner })) as [string];
  [cDraft] = (await contracts(sql, A, 1, { from: 902, createdBy: creator, status: "draft" })) as [
    string,
  ];
  [cAppx] = (await contracts(sql, A, 1, { from: 903, createdBy: creator, owner })) as [string];
  [cOther] = (await contracts(sql, B, 1, { from: 904, createdBy: foreign, owner: foreign })) as [
    string,
  ];
  await sql`update contracts.contracts set direction = 'sale',
    fields = fields || '{"buyer_name":{"value":"Cty Mua"},"type":{"value":"purchase"},"title":{"value":"khong chep"}}'::jsonb
    where id = ${cDone}`;
  await sql`update contracts.contracts set kind = 'appendix', parent_id = ${cDone} where id = ${cAppx}`;
  await visibility(sql, [A, B], "org");
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("CR-182 R6 · phụ lục ký sau (SQL thật)", () => {
  it("từ chối ⇒ PARENT_INVALID, rollback không còn hàng, tệp gỡ + quota hoàn: HĐ gốc tenant khác / không thấy / chưa xong / là phụ lục", async () => {
    const before = await appendixCount();
    const cases: [string, () => Promise<unknown>][] = [
      ["tenant khác", () => annex(A, creator, cOther)],
      [
        "không thấy (cùng tenant, org: ngang hàng chỉ thấy HĐ của mình)",
        () => annex(A, viewer, cDone),
      ],
      ["chưa xong", () => annex(A, creator, cDraft)],
      ["là phụ lục", () => annex(A, creator, cAppx)],
    ];
    for (const [name, p] of cases) {
      log.length = 0;
      expect([name, await codeOf(p())]).toEqual([name, "PARENT_INVALID"]);
      expect(log).toEqual(["put", "refund", "remove"]);
      expect(await appendixCount()).toBe(before);
    }
  });
  it("đúng ⇒ phụ lục kế thừa hướng + đối tác/loại, gắn HĐ gốc, không chép trường khác", async () => {
    const r = await annex(A, owner, cDone); // chế độ org: chỉ người phụ trách thấy HĐ gốc
    const [row] =
      await sql`select kind, parent_id, direction, fields from contracts.contracts where id = ${r.id}`;
    expect(row).toMatchObject({ kind: "appendix", parent_id: cDone, direction: "sale" });
    const f = (row as unknown as { fields: Record<string, { value: unknown }> }).fields;
    expect(f.buyer_name?.value).toBe("Cty Mua");
    expect(f.type?.value).toBe("purchase");
    expect(f.title?.value).not.toBe("khong chep");
  });
  it("N2: người phụ trách HĐ gốc (khác người tạo) tạo được phụ lục", async () => {
    expect(owner).not.toBe(creator);
    expect(await codeOf(annex(A, owner, cDone))).toBe("ok");
    // Chế độ «cả công ty»: người tạo HĐ gốc (không phụ trách) cũng tạo được.
    await visibility(sql, [A], "tenant");
    expect(await codeOf(annex(A, creator, cDone))).toBe("ok");
  });
  it("người chỉ có quyền xem (không tạo, không phụ trách) bị từ chối; quản trị gói thì được", async () => {
    // Chế độ «cả công ty»: người xem THẤY HĐ gốc nhưng không phải người tạo/phụ trách ⇒ vẫn bị từ chối.
    await visibility(sql, [A], "tenant");
    expect(await codeOf(annex(A, viewer, cDone))).toBe("PARENT_INVALID");
    expect(await codeOf(annex(A, admin, cDone, true))).toBe("ok");
  });
});
