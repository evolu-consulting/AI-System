// CR-188 · BR-188-4/5 «Giấy tờ đã ký bằng chữ ký này» (repo thật + pool hub_api + RLS gói): chữ ký phải của chính người gọi (người khác không phải
// quản trị ⇒ 403), quản trị xem được của người khác; HĐ người gọi không có quyền mở KHÔNG hiện; lọc loại + khoảng ngày; con trỏ 50/trang;
// MỘT câu SQL cho mọi trang.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, enablePack, members, tenants, users, visibility } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { decodeCursor, pageOf } from "../domain/sig-docs.rules";
import { type SigDocsFilter, sigDocsRepo } from "./sig-docs.repo";

let sql: Sql;
let db: Db;
let A = "";
let u1 = "";
let u2 = "";
let c1 = "";
let c3 = "";
let c4 = "";
let c5 = "";
let sigU1 = "";
let sigU2 = "";
let sigNone = "";
let statements = 0;

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => {
    const orig = tx.execute.bind(tx);
    tx.execute = ((...a: Parameters<typeof orig>) => {
      statements++;
      return orig(...a);
    }) as typeof tx.execute;
    return { docs: sigDocsRepo(tx, t) };
  });
const list = (userId: string, admin: boolean, sig: string, f: Partial<SigDocsFilter> = {}) =>
  uow().tenant({ tenantId: A, userId }, (r) =>
    r.docs.list(userId, admin, sig, { cursor: null, ...f }),
  );

async function mkFile(by: string, name: string): Promise<string> {
  const [r] = await sql<{ id: string }[]>`insert into contracts.files ${sql({
    tenant_id: A,
    org: `t_${A}`,
    file_id: `fb-${Bun.randomUUIDv7()}`,
    name,
    mime: "application/pdf",
    size_bytes: 10,
    created_by: by,
  } as never)} returning id`;
  return (r as { id: string }).id;
}

/** Một bản đã ký (ngày `at`) + một dấu ký của `signer` bằng chữ ký `sig`; `voided` ⇒ bản đã huỷ. */
async function signed(
  contract: string,
  signer: string,
  sig: string,
  name: string,
  at: string,
  voided = false,
): Promise<string> {
  const file = await mkFile(signer, `${name}.pdf`);
  const out = await mkFile(signer, `${name}-da-ky.pdf`);
  await sql`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by)
    values (${A}, ${contract}, ${file}, true, 1, ${signer})`;
  const [v] = await sql<{ id: string }[]>`insert into contracts.sign_versions
    (tenant_id, contract_id, file_id, seq, out_file_id, sha256, signed_by, created_at, voided_at)
    values (${A}, ${contract}, ${file}, 1, ${out}, ${Bun.randomUUIDv7().replaceAll("-", "").padEnd(64, "0")}, ${signer}, ${at},
      ${voided ? at : null}) returning id`;
  const vid = (v as { id: string }).id;
  await sql`insert into contracts.sign_marks (tenant_id, version_id, signer_id, placement, parts, user_signature_id)
    values (${A}, ${vid}, ${signer}, 'free', ${sql.json([{ page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }])}, ${sig})`;
  return vid;
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A] = (await tenants(sql, 1, 921)) as [string];
  [u1, u2] = (await users(sql, A, 2, { from: 921 })) as [string, string];
  const roles = await enablePack(sql, [A], "contracts");
  await members(sql, A, roles.get(A)?.editor as string, [u1, u2]);
  [c1, c3, c4, c5] = (await contracts(sql, A, 4, { from: 921, createdBy: u1, owner: u1 })) as [
    string,
    string,
    string,
    string,
  ];
  await visibility(sql, [A], "org");
  // c3 = phụ lục của c1; c4 do u1 tạo nhưng GIAO cho u2; c5 = giấy tờ khác (hợp đồng khung, không phải «hợp đồng»).
  await sql`update contracts.contracts set kind = 'appendix', parent_id = ${c1} where id = ${c3}`;
  await sql`update contracts.contracts set owner_user_id = ${u2} where id = ${c4}`;
  await sql`update contracts.contracts set doc_type = 'framework' where id = ${c5}`;
  sigU1 = Bun.randomUUIDv7();
  sigU2 = Bun.randomUUIDv7();
  sigNone = Bun.randomUUIDv7();
  // Chữ ký của u1: c1 (hợp đồng, 10/10), c3 (phụ lục, 15/10), c4 (đã giao u2 ⇒ u1 hết quyền mở, 20/10), c5 (khác, 25/10), c1 bản đã huỷ (không tính).
  await signed(c1, u1, sigU1, "hd", "2026-10-10T03:00:00Z");
  await signed(c3, u1, sigU1, "pl", "2026-10-15T03:00:00Z");
  await signed(c4, u1, sigU1, "giao", "2026-10-20T03:00:00Z");
  await signed(c5, u1, sigU1, "khac", "2026-10-25T03:00:00Z");
  await signed(c1, u1, sigU1, "huy", "2026-10-26T03:00:00Z", true);
  // Chữ ký của u2 (người được giao c4, KHÔNG phải người tạo): ký c4 (có quyền) và c1 (u2 không có quyền mở).
  await signed(c4, u2, sigU2, "u2-giao", "2026-11-01T03:00:00Z");
  await signed(c1, u2, sigU2, "u2-an", "2026-11-02T03:00:00Z");
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("CR-188 BR-188-4/5 · giấy tờ đã ký bằng chữ ký này", () => {
  it("chính chủ thấy giấy tờ mình có quyền mở (mới → cũ), HĐ đã giao người khác và bản đã huỷ không hiện", async () => {
    const rows = await list(u1, false, sigU1);
    expect(rows.map((r) => [r.contract_id, r.kind])).toEqual([
      [c5, "other"],
      [c3, "appendix"],
      [c1, "contract"],
    ]);
    expect(rows.every((r) => r.title !== "" && r.file_name.endsWith(".pdf"))).toBe(true);
  });
  it("người KHÁC (không phải quản trị) hỏi chữ ký của u1 ⇒ 403", async () => {
    await expect(list(u2, false, sigU1)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
  it("quản trị xem được chữ ký của người khác", async () => {
    const rows = await list(u2, true, sigU1);
    expect(rows.map((r) => r.contract_id)).toContain(c4);
  });
  it("N2: người được giao (không phải người tạo) thấy HĐ giao cho mình, HĐ không có quyền mở KHÔNG hiện", async () => {
    const rows = await list(u2, false, sigU2);
    const ids = rows.map((r) => r.contract_id);
    expect(ids).toContain(c4);
    expect(ids).not.toContain(c1);
  });
  it("lọc theo loại", async () => {
    const by = async (kind: SigDocsFilter["kind"]) =>
      (await list(u1, false, sigU1, { kind })).map((r) => r.contract_id);
    expect(await by("appendix")).toEqual([c3]);
    expect(await by("other")).toEqual([c5]);
    expect(new Set(await by("contract"))).toEqual(new Set([c1]));
  });
  it("lọc theo khoảng ngày (gồm cả ngày cuối)", async () => {
    const rows = await list(u1, false, sigU1, { from: "2026-10-12", to: "2026-10-20" });
    expect(rows.map((r) => r.contract_id)).toEqual([c3]);
  });
  it("chữ ký chưa ký gì ⇒ danh sách rỗng, không lỗi", async () => {
    expect(await list(u1, false, sigNone)).toEqual([]);
  });
  it("con trỏ: trang sau bắt đầu sau dòng cuối của trang trước", async () => {
    const all = await list(u1, false, sigU1);
    const last = all[1];
    const cur = decodeCursor(`${last?.signed_at}|${last?.version_id}`);
    const next = await list(u1, false, sigU1, { cursor: cur });
    expect(next.map((r) => r.version_id)).toEqual(all.slice(2).map((r) => r.version_id));
    expect(pageOf(all).next).toBeNull();
  });
  it("perf: mỗi lần gọi đúng MỘT câu SQL (cả lọc + con trỏ)", async () => {
    statements = 0;
    await uow().tenant({ tenantId: A, userId: u1 }, async () => 0);
    const base = statements; // câu hạ tầng của đơn vị công việc (đặt ngữ cảnh RLS), không thuộc repo
    statements = 0;
    await list(u1, false, sigU1, { kind: "contract", from: "2026-10-01", to: "2026-10-31" });
    expect(statements - base).toBe(1);
  });
});
