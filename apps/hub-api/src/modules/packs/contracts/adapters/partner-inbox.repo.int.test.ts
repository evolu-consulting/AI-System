// CR-125 G7 · `partnerInboxRepo.pendingCount` trên DB THẬT: chỉ đếm pending của đúng tenant (RLS + lọc tường minh), MỘT câu, đi qua index
// một phần `partner_inbox_pending_idx` (không quét lịch sử đã trả lời).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { seedPartnerInbox } from "../testing/partner-inbox.seed";
import { partnerInboxRepo } from "./partner-inbox.repo";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB = "";

const uow = () => createPackUow(db, "contracts", (tx, t) => ({ inbox: partnerInboxRepo(tx, t) }));

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1600)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1600 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1601 })) as [string];
  // A: 3000 thư, 7 chờ; B: 3000 thư, 11 chờ — phần lớn đã trả lời (lịch sử) để index một phần có ý nghĩa.
  await seedPartnerInbox(o, A, UA, { from: 170_000, total: 3000, pending: 7 });
  await seedPartnerInbox(o, B, UB, { from: 180_000, total: 3000, pending: 11 });
  await o`analyze contracts.partner_inbox`;
  db = createDb(urls().hubApi, { max: 4 });
}, 90_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("partnerInboxRepo.pendingCount", () => {
  it("đếm đúng pending của tenant mình, không lẫn tenant khác", async () => {
    expect(await uow().tenant({ tenantId: A, userId: UA }, (r) => r.inbox.pendingCount())).toBe(7);
    expect(await uow().tenant({ tenantId: B, userId: UB }, (r) => r.inbox.pendingCount())).toBe(11);
  });

  it("câu đếm đi qua index một phần (không Seq Scan)", async () => {
    const plan = (
      await o.unsafe(
        `explain select count(*)::int from contracts.partner_inbox where tenant_id = '${A}'::uuid and status = 'pending'`,
      )
    )
      .map((r) => String((r as Record<string, unknown>)["QUERY PLAN"]))
      .join("\n");
    expect(plan).toContain("partner_inbox_pending_idx");
    expect(plan).not.toContain("Seq Scan");
  });
});
