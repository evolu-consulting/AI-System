// gap-a2 #3 · `GET /contracts/:id/source` (use case thật + pool hub_api + RLS gói): văn bản gốc chỉ trả cho người THẤY HĐ.
// Chế độ org: người phụ trách đọc được văn bản HĐ của mình; đồng nghiệp ngang hàng ⇒ null (route ⇒ 404); owner gói thấy mọi HĐ; tenant khác ⇒ null.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, enablePack, members, tenants, users, visibility } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { type GetSource, getSource } from "../application/get-source.usecase";
import { contractsRepo } from "./contracts.repo";

let sql: Sql;
let db: Db;
let src: GetSource;
let A = "";
let B = "";
let own = "";
let u1 = "";
let u2 = "";
let other = "";
let c1 = "";
let c2 = "";

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 871)) as [string, string];
  [own, u1, u2] = (await users(sql, A, 3, { from: 871 })) as [string, string, string];
  [other] = (await users(sql, B, 1, { from: 881 })) as [string];
  const roles = await enablePack(sql, [A, B], "contracts");
  await members(sql, A, roles.get(A)?.owner as string, [own]);
  await members(sql, A, roles.get(A)?.editor as string, [u1, u2]);
  [c1] = (await contracts(sql, A, 1, { from: 871, createdBy: u1, owner: u1 })) as [string];
  [c2] = (await contracts(sql, A, 1, { from: 872, createdBy: u2, owner: u2 })) as [string];
  await sql`update contracts.contracts set source_text = 'Điều 1. của u1' where id = ${c1}`;
  await sql`update contracts.contracts set source_text = 'Điều 1. của u2' where id = ${c2}`;
  await visibility(sql, [A, B], "org");
  db = createDb(urls().hubApi, { max: 2 });
  src = getSource({
    uow: createPackUow(db, "contracts", (tx, t) => ({ contracts: contractsRepo(tx, t) })),
  });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("gap-a2 · văn bản gốc theo quyền thấy", () => {
  it("người phụ trách đọc được; ngang hàng / tenant khác ⇒ null; owner gói đọc mọi HĐ", async () => {
    const got = {
      own: await src({ tenantId: A, userId: u1 }, c1),
      peer: await src({ tenantId: A, userId: u2 }, c1),
      owner: await src({ tenantId: A, userId: own }, c2),
      foreign: await src({ tenantId: B, userId: other }, c1),
    };
    expect(got).toEqual({
      own: "Điều 1. của u1",
      peer: null,
      owner: "Điều 1. của u2",
      foreign: null,
    });
  });
});
