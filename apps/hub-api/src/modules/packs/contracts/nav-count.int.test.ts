// CR-127 · RA1 (b) · số đếm menu `contracts.review` = việc duyệt + việc «Xác nhận mốc» (engine `inboxOf`, MỘT câu) + HĐ nhận chờ
// CHÍNH mình quyết (`awaiting_decision`, gói). DB thật (role hub_api / contracts_rw): 1 duyệt + 1 mốc + 1 nhận ⇒ 3 cho người phụ trách
// (thành viên phòng); chỉ 2 cho thành viên phòng không phụ trách HĐ nhận; ngoài phòng ⇒ không mục.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { ProcessDeps } from "../../processes/core/ports";
import { inboxOf } from "../../processes/runs/pack-runs-view";
import { type ClaimWorld, claimWorld, groupTask } from "../../processes/testing/claim-seed";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { PackRunsBridge } from "../kit/public";
import { partnerAwaitingCount } from "./adapters/mywork.repo";
import { contractsNavSource } from "./nav.mount";

let o: Sql;
let db: Db;
let w: ClaimWorld;

const deps = () =>
  ({
    db,
    config: { user: async (uid: string) => ({ groupIds: new Set(w.groupsOf.get(uid) ?? []) }) },
  }) as unknown as ProcessDeps;
const runs = (): PackRunsBridge =>
  ({
    port: { inboxOf: (u: never, k: string, s: string) => inboxOf(deps(), u, k, s) },
  }) as never;
const nav = async (userId: string) => {
  const pack = createPackUow(db, "contracts", (tx, t) => ({
    n: () => partnerAwaitingCount(tx, t),
  }));
  const src = contractsNavSource(
    async () => true,
    runs(),
    (u) => pack.tenant({ userId: u.userId, tenantId: u.tenantId }, (r) => r.n()),
  );
  return src.caps({ userId, tenantId: w.T, role: "member", userKind: "internal" } as never);
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1272);
  db = createDb(urls().hubApi, { max: 4 });
  const asPack = async (taskId: string, runId: string) => {
    await o`update hub.process_runs set pack_key = 'contracts', pack_record_id = gen_random_uuid() where id = ${runId}`;
    return taskId;
  };
  // 1 việc duyệt giao phòng G (A, B thuộc G)
  const rv = await groupTask(o, w, w.G);
  await asPack(rv.taskId, rv.runId);
  // 1 việc mốc giao phòng G
  const ms = await groupTask(o, w, w.G);
  await asPack(ms.taskId, ms.runId);
  await o`update hub.review_tasks set kind = 'milestone', subject_ref = ${crypto.randomUUID()} where id = ${ms.taskId}`;
  // 1 HĐ nhận chờ A quyết
  const [c] = await contracts(o, w.T, 1, {
    from: 1272,
    createdBy: w.S,
    status: "processing",
    owner: w.A,
  });
  await o`insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, expires_at, awaiting_decision)
    values (${w.T}, ${c as string}, gen_random_uuid(), 'Đối tác', now() + interval '7 day', true)`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 RA1 · số đếm contracts.review", () => {
  it("1 duyệt + 1 mốc + 1 nhận ⇒ 3 cho người phụ trách HĐ nhận", async () => {
    expect(await nav(w.A)).toEqual([{ cap: "contracts.review", count: 3 }]);
  });
  it("thành viên phòng không phụ trách HĐ nhận ⇒ 2 (duyệt + mốc); ngoài phòng ⇒ không mục", async () => {
    expect(await nav(w.B)).toEqual([{ cap: "contracts.review", count: 2 }]);
    expect(await nav(w.X)).toEqual([]);
  });
});
