// CR-127 K3 · BR-02/04 · spec §3 #7b, §2.1 (#76, #78, #79, #80): lượt huỷ/lỗi/hết hạn/không mở được ⇒ HĐ processing → draft qua cổng theo
// tập (`contracts.transition_set`, MIGC 0092). Chạy trong tx `system` của engine (role `hub_api`) như thật: hook từng lượt đổi sang
// `contracts_rw`; `failedBatch` đổi sang role `contracts_job` THẬT (không dùng role chủ) — đúng N hàng + N `contract_events`, chặn chéo
// tenant, đếm câu. Thêm: `contract_submissions` chặn đọc chéo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql as dsql } from "drizzle-orm";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { endFlowRun, failRunsBatch } from "./flow-end.repo";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB = "";

/** HĐ processing + lượt duyệt engine đang mở (run engine = `run`, null = chưa có run). Trả {id, approval, run}. */
async function processing(tid: string, uid: string, run: string | null = crypto.randomUUID()) {
  const id = crypto.randomUUID();
  const aid = crypto.randomUUID();
  await o`insert into contracts.contracts ${o({ id, tenant_id: tid, title: "HĐ K3", created_by: uid, status: "processing", run_id: aid } as never)}`;
  await o`insert into contracts.approvals ${o({ id: aid, tenant_id: tid, contract_id: id, status: "level1", started_by: uid, mode: "engine", engine_run_id: run } as never)}`;
  return { id, aid, run };
}
const stateOf = async (id: string) => {
  const [r] = await o<{ status: string; a: string; n: number }[]>`select c.status, x.status as a,
    (select count(*)::int from contracts.contract_events e where e.contract_id = c.id and e.type = 'status_changed') as n
    from contracts.contracts c join contracts.approvals x on x.id = c.run_id where c.id = ${id}`;
  return r;
};
const engineTx = <T>(fn: (tx: Tx) => Promise<T>) => withHubScope(db, { kind: "system" }, fn);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [A, B] = (await tenants(o, 2, 9327)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 9327 })) as [string];
  [UB] = (await users(o, B, 1, { from: 9337 })) as [string];
}, 120_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 K3 hook từng lượt (cancelled / failed / not_launched)", () => {
  it("huỷ đúng run ⇒ draft + lượt cancelled + event; gọi lại / run khác ⇒ bỏ qua, không ném", async () => {
    const k = await processing(A, UA);
    const wrong = await engineTx((tx) =>
      endFlowRun(
        tx,
        { tenantId: A, ref: k.id, runId: crypto.randomUUID(), reason: "stop" },
        "flow_cancelled",
      ),
    );
    expect(wrong).toBe(false);
    const ok = await engineTx((tx) =>
      endFlowRun(tx, { tenantId: A, ref: k.id, runId: k.run, reason: "stop" }, "flow_cancelled"),
    );
    expect(ok).toBe(true);
    expect(await stateOf(k.id)).toEqual({ status: "draft", a: "cancelled", n: 1 });
    const again = await engineTx((tx) =>
      endFlowRun(tx, { tenantId: A, ref: k.id, runId: k.run, reason: "stop" }, "flow_cancelled"),
    );
    expect(again).toBe(false);
    const [ev] = await o<
      { data: { ev: string; to: string } }[]
    >`select data from contracts.contract_events
      where contract_id = ${k.id} and type = 'status_changed'`;
    expect(ev?.data.ev).toBe("flow_cancelled");
  });

  it("lỗi ⇒ failed; không mở được (chưa có run) ⇒ draft; tenant sai ⇒ không đổi", async () => {
    const f = await processing(A, UA);
    expect(
      await engineTx((tx) =>
        endFlowRun(tx, { tenantId: A, ref: f.id, runId: f.run, reason: "x" }, "flow_failed"),
      ),
    ).toBe(true);
    expect((await stateOf(f.id))?.a).toBe("failed");
    const nl = await processing(A, UA, null);
    expect(
      await engineTx((tx) =>
        endFlowRun(
          tx,
          { tenantId: B, ref: nl.id, runId: null, reason: "FLOW_NOT_ASSIGNED" },
          "flow_not_launched",
        ),
      ),
    ).toBe(false);
    expect(
      await engineTx((tx) =>
        endFlowRun(
          tx,
          { tenantId: A, ref: nl.id, runId: null, reason: "FLOW_NOT_ASSIGNED" },
          "flow_not_launched",
        ),
      ),
    ).toBe(true);
    expect(await stateOf(nl.id)).toEqual({ status: "draft", a: "failed", n: 1 });
  });
});

describe("CR-127 K3 failedBatch dưới role contracts_job thật (#76, #78, #79, #80)", () => {
  it("lô nhiều tenant: đúng N hàng + N event, CAS run, chặn chéo tenant, ≤ 3 câu, trả role", async () => {
    const a1 = await processing(A, UA);
    const a2 = await processing(A, UA); // run lệch ⇒ không đổi
    const b1 = await processing(B, UB);
    const b2 = await processing(B, UB); // item mang tenant A + id HĐ của B ⇒ không đổi (#78)
    let calls = 0;
    const out = await engineTx(async (tx) => {
      const counted = new Proxy(tx, {
        get(t, p, r) {
          if (p === "execute") calls++;
          return Reflect.get(t, p, r);
        },
      });
      const n = await failRunsBatch(counted as Tx, [
        {
          tenantId: A,
          event: "contract.submitted",
          ref: a1.id,
          runId: a1.run as string,
          reason: "expired",
        },
        {
          tenantId: A,
          event: "contract.submitted",
          ref: a2.id,
          runId: crypto.randomUUID(),
          reason: "expired",
        },
        {
          tenantId: B,
          event: "contract.submitted",
          ref: b1.id,
          runId: b1.run as string,
          reason: "expired",
        },
        {
          tenantId: A,
          event: "contract.submitted",
          ref: b2.id,
          runId: b2.run as string,
          reason: "expired",
        },
      ]);
      const [who] = await tx.execute<{ u: string }>(dsql`select current_user::text as u`);
      return { n, who: who?.u };
    });
    expect(out.n).toBe(2);
    expect(out.who).not.toBe("contracts_job");
    expect(calls).toBeLessThanOrEqual(3);
    expect(await stateOf(a1.id)).toEqual({ status: "draft", a: "failed", n: 1 });
    expect(await stateOf(b1.id)).toEqual({ status: "draft", a: "failed", n: 1 });
    expect(await stateOf(a2.id)).toEqual({ status: "processing", a: "level1", n: 0 });
    expect(await stateOf(b2.id)).toEqual({ status: "processing", a: "level1", n: 0 });
  });

  it("role contracts_job không ghi được HĐ ngoài processing / không đọc cột khác", async () => {
    const [r] = await o<{ upd: boolean; sel: boolean }[]>`select
      has_column_privilege('contracts_job', 'contracts.contracts', 'title', 'UPDATE') as upd,
      has_column_privilege('contracts_job', 'contracts.contracts', 'title', 'SELECT') as sel`;
    expect(r).toEqual({ upd: false, sel: false });
  });
});

describe("CR-127 K3 contract_submissions — chặn đọc chéo tenant", () => {
  it("tenant A chỉ thấy hồ sơ của A", async () => {
    const ka = await processing(A, UA);
    const kb = await processing(B, UB);
    await o`insert into contracts.contract_submissions ${o([
      { tenant_id: A, contract_id: ka.id, round: 1, submitted_by: UA },
      { tenant_id: B, contract_id: kb.id, round: 1, submitted_by: UB },
    ] as never)}`;
    const uow = createPackUow(db, "contracts", (tx) => ({ tx }));
    const seen = await uow.tenant({ tenantId: A, userId: UA }, async ({ tx }) =>
      tx.execute<{
        contract_id: string;
      }>(dsql`select contract_id from contracts.contract_submissions
        where contract_id in (${ka.id}::uuid, ${kb.id}::uuid)`),
    );
    expect([...seen].map((r) => r.contract_id)).toEqual([ka.id]);
  });
});
