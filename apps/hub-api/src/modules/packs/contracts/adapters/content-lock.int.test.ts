// CR-127 K4 · BR-39: khoá nội dung theo trạng thái trên DB thật (role gói `contracts_rw` + RLS) — PATCH trường HĐ:
// draft / reject sửa được; processing / done ⇒ `locked` (409 `CONTRACT_LOCKED`), không ghi, không tăng version, không event.
// BR-38/74: đường "Mở lại" đã gỡ — `POST /contracts/:id/reopen` ⇒ 404 (unit `manage.routes.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { contracts as seedContracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow, packTenantOnly } from "../../kit/public";
import { patchFields } from "../application/patch-fields.usecase";
import { appendixRepo } from "./appendix.repo";
import { contractsRepos } from "./contracts.repo";
import { milestonesRepo } from "./milestones.repo";
import { patchReply } from "./patch-fields.http";
import { reviewRepo } from "./review.repo";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let n = 100;
const run = () =>
  patchFields({ uow: packTenantOnly(createPackUow(db, "contracts", contractsRepos)) });
const who = () => ({ tenantId: T, userId: U });

const seed = async (status: string): Promise<string> => {
  n += 1;
  const [id] = await seedContracts(o, T, 1, { from: n, createdBy: U, status });
  return id as string;
};
const state = async (id: string) =>
  (
    await o<{ version: number; events: number }[]>`select c.version,
      (select count(*)::int from contracts.contract_events e where e.contract_id = c.id and e.type = 'field_edited') as events
      from contracts.contracts c where c.id = ${id}`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9440)) as [string];
  [U] = (await users(o, T, 1, { from: 9440 })) as [string];
}, 120_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 K4 · khoá nội dung theo trạng thái", () => {
  it("draft và reject: PATCH sửa được (version +1, có event)", async () => {
    for (const status of ["draft", "reject"]) {
      const id = await seed(status);
      const out = patchReply(await run()(who(), id, { version: 1, fields: { notice_days: 45 } }));
      expect([status, out.version]).toEqual([status, 2]);
      expect(await state(id)).toEqual({ version: 2, events: 1 });
    }
  });

  it("processing và done: PATCH ⇒ 409 CONTRACT_LOCKED, không ghi gì", async () => {
    for (const status of ["processing", "done"]) {
      const id = await seed(status);
      const res = await run()(who(), id, { version: 1, fields: { notice_days: 45 } });
      expect([status, res.kind]).toEqual([status, "locked"]);
      let err: { code?: string; status?: number } = {};
      try {
        patchReply(res);
      } catch (e) {
        err = e as typeof err;
      }
      expect([err.code, err.status]).toEqual(["CONTRACT_LOCKED", 409]);
      expect(await state(id)).toEqual({ version: 1, events: 0 });
    }
  });

  it("tenant khác không thấy HĐ ⇒ not_found (không lộ trạng thái khoá)", async () => {
    const id = await seed("done");
    const [T2] = (await tenants(o, 1, 9441)) as [string];
    const res = await run()({ tenantId: T2, userId: U }, id, {
      version: 1,
      fields: { notice_days: 1 },
    });
    expect(res.kind).toBe("not_found");
  });

  it("sửa kế hoạch mốc / gắn sản phẩm dòng hàng / gắn HĐ gốc: draft cho phép, processing và done ⇒ locked", async () => {
    const uow = createPackUow(db, "contracts", (tx, tid) => ({
      ms: milestonesRepo(tx, tid),
      ap: appendixRepo(tx, tid),
      rv: reviewRepo(tx, tid),
    }));
    for (const status of ["draft", "processing", "done"]) {
      const id = await seed(status);
      await o`insert into contracts.contract_items (tenant_id, contract_id, ord, name) values (${T}, ${id}, 1, 'Hàng')`;
      const [item] = await o<
        { id: string }[]
      >`select id from contracts.contract_items where contract_id = ${id}`;
      const got = await uow.tenant(who(), async (r) => ({
        ms: (await r.ms.lockContract(id))?.locked,
        ap: (await r.ap.lockForParent(id, null))?.locked,
        pr: (
          await r.rv.attachProduct(
            id,
            (item as { id: string }).id,
            { product_id: null, component_ids: null },
            U,
          )
        ).kind,
      }));
      const locked = status !== "draft";
      expect([status, got.ms, got.ap, got.pr === "contract_locked"]).toEqual([
        status,
        locked,
        locked,
        locked,
      ]);
    }
  });

  it("giao dịch (doc_type = deal) done vẫn sửa được: PATCH trường + kế hoạch mốc + gắn sản phẩm không bị khoá (FIX-Q1c)", async () => {
    const id = await seed("done");
    await o`update contracts.contracts set doc_type = 'deal', source = 'other', deal = 'sell', direction = 'sale' where id = ${id}`;
    const out = patchReply(await run()(who(), id, { version: 1, fields: { notice_days: 45 } }));
    expect(out.version).toBe(2);
    await o`insert into contracts.contract_items (tenant_id, contract_id, ord, name) values (${T}, ${id}, 1, 'Hàng')`;
    const uow = createPackUow(db, "contracts", (tx, tid) => ({
      ms: milestonesRepo(tx, tid),
      ap: appendixRepo(tx, tid),
    }));
    const got = await uow.tenant(who(), async (r) => ({
      ms: (await r.ms.lockContract(id))?.locked,
      ap: (await r.ap.lockForParent(id, null))?.locked,
    }));
    expect(got).toEqual({ ms: false, ap: false });
  });
});
