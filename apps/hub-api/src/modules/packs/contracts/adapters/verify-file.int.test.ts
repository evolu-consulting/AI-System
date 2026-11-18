// CR-182 · R7 «Kiểm tra tệp» (repo thật + pool hub_api + RLS gói): khớp bản đã ký; khớp tệp gốc; sửa 1 byte ⇒ không khớp;
// người không thấy HĐ ⇒ «không khớp» (không lộ); tenant khác ⇒ không khớp.
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
let fileId = "";
let versionId = "";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const ORIGINAL = new TextEncoder().encode("PDF gốc của phụ lục — nội dung A");
const SIGNED = new TextEncoder().encode("PDF đã ký — nội dung A + dấu ký");

const uow = () => createPackUow(db, "contracts", (tx, t) => ({ verify: verifyFileRepo(tx, t) }));
/** Đúng đường của route: băm tệp ⇒ tìm trong công ty + quyền xem ⇒ chọn kết quả. */
const verify = async (tenantId: string, userId: string, bytes: Uint8Array) =>
  pickMatch(await uow().tenant({ tenantId, userId }, (r) => r.verify.find(sha(bytes))));

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
  await visibility(sql, [A, B], "org");
  fileId = await mkFile(A, u1, "phu-luc.pdf");
  const out = await mkFile(A, u1, "phu-luc-da-ky.pdf");
  await sql`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by, src_sha256)
    values (${A}, ${c1}, ${fileId}, true, 1, ${u1}, ${sha(ORIGINAL)})`;
  const [v] = await sql<{ id: string }[]>`insert into contracts.sign_versions
    (tenant_id, contract_id, file_id, seq, out_file_id, sha256, signed_by)
    values (${A}, ${c1}, ${fileId}, 1, ${out}, ${sha(SIGNED)}, ${u1}) returning id`;
  versionId = (v as { id: string }).id;
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("CR-182 R7 · kiểm tra tệp", () => {
  it("khớp bản đã ký ⇒ HĐ, mã kiểm tra, người ký, bản để mở", async () => {
    expect(await verify(A, u1, SIGNED)).toMatchObject({
      match: true,
      which: "signed",
      contract: { id: c1 },
      check_code: sha(SIGNED).slice(0, 8).toUpperCase(),
      signed_by: u1,
      file_id: fileId,
      version_id: versionId,
      seq: 1,
    });
  });
  it("khớp tệp gốc cần ký ⇒ «Bản gốc»", async () => {
    expect(await verify(A, u1, ORIGINAL)).toMatchObject({
      match: true,
      which: "original",
      contract: { id: c1 },
      signed_by: null,
    });
  });
  it("tệp sửa 1 byte ⇒ không khớp", async () => {
    const edited = SIGNED.slice();
    edited[3] = (edited[3] ?? 0) ^ 1;
    expect(await verify(A, u1, edited)).toEqual({ match: false });
  });
  it("người không có quyền xem HĐ ⇒ không khớp, không lộ", async () => {
    // Chế độ org: u2 là đồng nghiệp ngang hàng, không phải người tạo/phụ trách c1.
    expect(await verify(A, u2, SIGNED)).toEqual({ match: false });
    expect(await verify(A, u2, ORIGINAL)).toEqual({ match: false });
  });
  it("khác công ty ⇒ không khớp (cả hai chiều)", async () => {
    expect(await verify(B, other, SIGNED)).toEqual({ match: false });
    expect(c2).not.toBe(c1);
  });
});
