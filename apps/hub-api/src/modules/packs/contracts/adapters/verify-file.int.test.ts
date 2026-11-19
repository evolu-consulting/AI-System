// CR-188 · BR-188-6 «Kiểm tra tệp» (repo thật + pool hub_api + RLS gói): dò MỌI bản đã ký của công ty (HĐ, phụ lục, phiên bản cũ);
// khớp HĐ không có quyền xem ⇒ chỉ «khớp», không chi tiết; tệp gốc chưa ký ⇒ không khớp (Q3); tenant khác ⇒ không khớp hai chiều.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { createDb, type Db } from "@ai/db";
import { contracts, enablePack, members, tenants, users, visibility } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { pickMatch } from "../domain/verify-file.rules";
import { verifyFileRepo } from "./verify-file.repo";

let sql: Sql;
let db: Db;
let A = "";
let B = "";
let u1 = "";
let u2 = "";
let other = "";
let c1 = "";
let c2 = "";
let c3 = "";
let c4 = "";
let fileId = "";
let versionId = "";

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const ORIGINAL = enc("PDF gốc chưa ký — nội dung A");
const SIGNED = enc("PDF đã ký — nội dung A + dấu ký");
const OLD = enc("PDF đã ký — phiên bản cũ");
const ANNEX = enc("PDF phụ lục đã ký");
const ASSIGNED = enc("PDF HĐ giao cho người khác đã ký");
const OF_B = enc("PDF đã ký của công ty B");

const uow = () => createPackUow(db, "contracts", (tx, t) => ({ verify: verifyFileRepo(tx, t) }));
/** Đúng đường của route: băm tệp ⇒ MỘT câu dò trong công ty ⇒ chọn kết quả (`from` = HĐ đang mở). */
const verify = async (
  tenantId: string,
  userId: string,
  bytes: Uint8Array,
  from: string | null = null,
) =>
  pickMatch(await uow().tenant({ tenantId, userId }, (r) => r.verify.find(sha(bytes), from)), from);

async function mkFile(tenant: string, by: string, name: string): Promise<string> {
  const [r] = await sql<{ id: string }[]>`insert into contracts.files ${sql({
    tenant_id: tenant,
    org: `t_${tenant}`,
    file_id: `fb-${Bun.randomUUIDv7()}`,
    name,
    mime: "application/pdf",
    size_bytes: 10,
    created_by: by,
  } as never)} returning id`;
  return (r as { id: string }).id;
}

/** Một tệp giấy tờ của HĐ + một phiên bản đã ký (`signed_by` = người ký). */
async function signed(
  tenant: string,
  contract: string,
  by: string,
  name: string,
  bytes: Uint8Array,
): Promise<{ file: string; version: string }> {
  const file = await mkFile(tenant, by, `${name}.pdf`);
  const out = await mkFile(tenant, by, `${name}-da-ky.pdf`);
  await sql`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by)
    values (${tenant}, ${contract}, ${file}, true, 1, ${by})`;
  const [v] = await sql<{ id: string }[]>`insert into contracts.sign_versions
    (tenant_id, contract_id, file_id, seq, out_file_id, sha256, signed_by)
    values (${tenant}, ${contract}, ${file}, 1, ${out}, ${sha(bytes)}, ${by}) returning id`;
  return { file, version: (v as { id: string }).id };
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 891)) as [string, string];
  [u1, u2] = (await users(sql, A, 2, { from: 891 })) as [string, string];
  [other] = (await users(sql, B, 1, { from: 893 })) as [string];
  const roles = await enablePack(sql, [A, B], "contracts");
  await members(sql, A, roles.get(A)?.editor as string, [u1, u2]);
  await members(sql, B, roles.get(B)?.editor as string, [other]);
  [c1] = (await contracts(sql, A, 1, { from: 891, createdBy: u1, owner: u1 })) as [string];
  [c2] = (await contracts(sql, B, 1, { from: 892, createdBy: other, owner: other })) as [string];
  [c3, c4] = (await contracts(sql, A, 2, { from: 895, createdBy: u1, owner: u1 })) as [
    string,
    string,
  ];
  await visibility(sql, [A, B], "org");
  // c3 = phụ lục của c1; c4 do u1 tạo nhưng GIAO cho u2 (người được giao ≠ người tạo).
  await sql`update contracts.contracts set kind = 'appendix', parent_id = ${c1} where id = ${c3}`;
  await sql`update contracts.contracts set owner_user_id = ${u2} where id = ${c4}`;
  // c1: tệp gốc chưa ký (có src_sha256) + bản đã ký seq 1 (cũ, bị thay) + seq 2 (mới nhất) trên cùng tệp.
  fileId = await mkFile(A, u1, "hd.pdf");
  await sql`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by, src_sha256)
    values (${A}, ${c1}, ${fileId}, true, 1, ${u1}, ${sha(ORIGINAL)})`;
  const o1 = await mkFile(A, u1, "hd-ky-1.pdf");
  const o2 = await mkFile(A, u1, "hd-ky-2.pdf");
  await sql`insert into contracts.sign_versions (tenant_id, contract_id, file_id, seq, out_file_id, sha256, signed_by)
    values (${A}, ${c1}, ${fileId}, 1, ${o1}, ${sha(OLD)}, ${u1})`;
  const [v] = await sql<{ id: string }[]>`insert into contracts.sign_versions
    (tenant_id, contract_id, file_id, seq, out_file_id, sha256, signed_by)
    values (${A}, ${c1}, ${fileId}, 2, ${o2}, ${sha(SIGNED)}, ${u1}) returning id`;
  versionId = (v as { id: string }).id;
  await signed(A, c3, u1, "phu-luc", ANNEX);
  await signed(A, c4, u1, "giao-u2", ASSIGNED);
  await signed(B, c2, other, "cua-b", OF_B);
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("CR-188 BR-188-6 · kiểm tra tệp toàn công ty", () => {
  it("khớp bản đã ký ⇒ HĐ, loại, mã kiểm tra, người ký, bản để mở", async () => {
    expect(await verify(A, u1, SIGNED)).toMatchObject({
      match: true,
      visible: true,
      other: false,
      contract: { id: c1, kind: "contract" },
      check_code: sha(SIGNED).slice(0, 8).toUpperCase(),
      signed_by: u1,
      file_id: fileId,
      version_id: versionId,
      seq: 2,
    });
  });
  it("khớp phụ lục đã ký ⇒ loại «phụ lục»", async () => {
    expect(await verify(A, u1, ANNEX)).toMatchObject({
      match: true,
      visible: true,
      contract: { id: c3, kind: "appendix" },
    });
  });
  it("khớp phiên bản cũ đã ký (không phải bản mới nhất) ⇒ vẫn khớp", async () => {
    expect(await verify(A, u1, OLD)).toMatchObject({
      match: true,
      visible: true,
      contract: { id: c1 },
      seq: 1,
    });
  });
  it("tệp gốc chưa ký ⇒ không khớp (Q3)", async () => {
    expect(await verify(A, u1, ORIGINAL)).toMatchObject({
      match: false,
      visible: false,
      contract: null,
    });
  });
  it("tệp sửa 1 byte ⇒ không khớp", async () => {
    const edited = SIGNED.slice();
    edited[3] = (edited[3] ?? 0) ^ 1;
    expect(await verify(A, u1, edited)).toMatchObject({ match: false, contract: null });
  });
  it("khớp HĐ không có quyền xem ⇒ chỉ «khớp», không chi tiết, cùng hình dạng", async () => {
    // Chế độ org: u2 là đồng nghiệp ngang hàng, không phải người tạo/phụ trách c1.
    const hidden = await verify(A, u2, SIGNED);
    expect(hidden).toMatchObject({
      match: true,
      visible: false,
      contract: null,
      check_code: null,
      signed_by: null,
      signed_at: null,
      file_id: null,
      version_id: null,
      seq: null,
    });
    expect(Object.keys(hidden).sort()).toEqual(Object.keys(await verify(A, u1, SIGNED)).sort());
    expect(JSON.stringify(hidden)).not.toContain(c1);
  });
  it("N2 · người được giao (≠ người tạo) thấy chi tiết, người tạo không còn là chủ ⇒ bị che", async () => {
    expect(await verify(A, u2, ASSIGNED)).toMatchObject({
      match: true,
      visible: true,
      contract: { id: c4 },
    });
    expect(await verify(A, u1, ASSIGNED)).toMatchObject({
      match: true,
      visible: false,
      contract: null,
    });
  });
  it("mở từ HĐ này mà khớp HĐ khác ⇒ other=true, khớp chính HĐ đó ⇒ other=false", async () => {
    expect(await verify(A, u1, ANNEX, c1)).toMatchObject({
      match: true,
      visible: true,
      other: true,
      contract: { id: c3 },
    });
    expect(await verify(A, u1, SIGNED, c1)).toMatchObject({
      match: true,
      other: false,
      contract: { id: c1 },
    });
  });
  it("khác công ty ⇒ không khớp (cả hai chiều)", async () => {
    expect(await verify(B, other, SIGNED)).toMatchObject({ match: false, visible: false });
    expect(await verify(A, u1, OF_B)).toMatchObject({ match: false, contract: null });
    expect(await verify(B, other, OF_B)).toMatchObject({
      match: true,
      visible: true,
      contract: { id: c2 },
    });
  });
});
