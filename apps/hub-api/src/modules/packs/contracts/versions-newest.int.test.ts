// CR-151f mục 21b · DB thật: chuỗi phiên bản dài hơn trần 100 ⇒ chi tiết trả 100 bản MỚI NHẤT (tăng dần), `versions_count` là tổng;
// công ty khác không thấy.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CONTRACT_VERSIONS_MAX } from "@ai/contracts/pack-contracts";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../kit/adapters/pack-uow";
import { contractsRepo } from "./adapters/contracts.repo";

const N = CONTRACT_VERSIONS_MAX + 2;
let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB = "";
let LAST = "";
const as = (t: string, u: string) => ({ tenantId: t, userId: u });
const uow = () => createPackUow(db, "contracts", (tx, t) => ({ c: contractsRepo(tx, t) }));

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1530)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1530 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1531 })) as [string];
  const ids = (await contracts(o, A, N, { from: 1530, createdBy: UA, status: "done" })) as string[];
  for (const [i, id] of ids.entries())
    await o`update contracts.contracts set root_id = ${ids[0] as string}, version_no = ${i + 1},
      supersedes_id = ${i === 0 ? null : (ids[i - 1] as string)} where id = ${id}`;
  LAST = ids[N - 1] as string;
  db = createDb(urls().hubApi, { max: 4 });
}, 90_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-151f · 21b phiên bản HĐ", () => {
  it("chuỗi > trần: trả 100 bản mới nhất tăng dần, versions_count là tổng", async () => {
    const d = await uow().tenant(as(A, UA), ({ c }) => c.detail(LAST));
    const v = d?.versions ?? [];
    expect(v.length).toBe(CONTRACT_VERSIONS_MAX);
    expect(v[0]?.version_no).toBe(3);
    expect(v[v.length - 1]?.version_no).toBe(N);
    expect(d?.versions_count).toBe(N);
  });

  it("công ty khác không thấy HĐ", async () => {
    expect(await uow().tenant(as(B, UB), ({ c }) => c.detail(LAST))).toBeNull();
  });
});
