// CR-122 · E1 · FLOW2-FR-03/19/20 · int (DB thật `hub_api`): hàng đợi `flow_events` idempotent `(tenant, event_id)`; bộ điều phối
// khớp flow đang bật theo sự kiện + điều kiện, sự kiện `decides` chỉ flow đầu theo `position`, cờ tắt ⇒ bóng; hai Hub đồng thời ⇒
// mỗi (sự kiện × flow) một lần mở; lỗi ⇒ thử lại có lùi, quá 5 lần ⇒ lỗi; RLS chặn đọc chéo tenant 3 bảng mới. `launch` giả (đếm).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../lib/db";
import { APPROVAL_DEFAULT_DEF } from "../../packs/contracts/domain/approval-slot-default.rules";
import { dispatchOnce, type FlowLaunch, FlowLaunchRefused } from "./dispatcher";
import { insertFlowEvents } from "./dispatcher.repo";
import { setFlowTriggers } from "./flags";

const X = tenantId(1221);
const Y = tenantId(1222);
const UX = userId(1221);
const UY = userId(1222);
const DFLT = APPROVAL_DEFAULT_DEF.id;
/** Đồng hồ giả SAU giờ DB (`next_at` mặc định = now() của DB) ⇒ sự kiện vừa ghi đã tới hạn. */
const T0 = new Date(Date.now() + 60_000);
const SYS = { kind: "system" as const };

let o: Sql;
let db: Db;
const cf: Record<string, string> = {};
const launched: string[] = [];
let failNext = 0;
const launch: FlowLaunch = async (e, c) => {
  if (failNext > 0) {
    failNext--;
    throw new Error("tạm lỗi");
  }
  if (c.defKey === "e1-refuse") throw new FlowLaunchRefused("PROCESS_NOT_RUNNABLE");
  launched.push(`${e.ref}|${c.defKey}`);
  return { runId: crypto.randomUUID() };
};
const run = (now = T0) => dispatchOnce({ db, launch, now: () => now });

/** Def công ty có trigger + dòng `company_flows`. */
async function flow(t: string, key: string, position: number, trigger: object, enabled = true) {
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description,
      input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs, trigger)
    select ${t}, ${key}, ${key}, '', input_hint, run_group_ids, stages, token_budget, true, sources, inputs,
      ${o.json(trigger as never)} from hub.process_defs where id = ${DFLT} returning id::text as id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.company_flows (tenant_id, flow_id, enabled, position)
    values (${t}, ${d?.id as string}, ${enabled}, ${position}) returning id::text as id`;
  cf[key] = r?.id as string;
}
const emit = (t: string, eventId: string, event: string, ref: string, facts: object, actor = UX) =>
  withHubScope(db, SYS, (tx) =>
    insertFlowEvents(tx, [
      { tenantId: t, eventId, event, ref, facts: facts as never, actorId: actor },
    ]),
  );
const row = async (t: string, eventId: string) =>
  (
    await o<
      {
        outcome: Record<string, unknown> | null;
        processed: boolean;
        attempts: number;
        error: string | null;
      }[]
    >`select outcome, processed_at is not null as processed, attempts, error from hub.flow_events
      where tenant_id = ${t} and event_id = ${eventId}`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1221', 'X'), (${Y}, 't1222', 'Y')`;
  await users(o, X, 1, { from: 1221 });
  await users(o, Y, 1, { from: 1222 });
  const sub = "contract.submitted";
  await flow(X, "e1-lon", 0, {
    event: sub,
    when: { op: "and", conds: [{ fact: "total_value", op: "ge", value: 1000 }] },
  });
  await flow(X, "e1-chung", 1, { event: sub });
  await flow(X, "e1-tat", 2, { event: sub }, false);
  await flow(X, "e1-bai-a", 0, { event: "post.created" }); // decides — chỉ flow đầu
  await flow(X, "e1-bai-b", 1, { event: "post.created" });
  await flow(X, "e1-tai-a", 0, { event: "contract.uploaded" }); // không decides — chạy tất cả
  await flow(X, "e1-tai-b", 1, { event: "contract.uploaded" });
  await flow(X, "e1-refuse", 0, { event: "contract.approved" });
  await flow(Y, "e1-y", 0, { event: sub });
  await withHubScope(db, SYS, (tx) => setFlowTriggers(tx, X, true));
});

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-122 E1 · hàng đợi + bộ điều phối", () => {
  it("ghi sự kiện hai lần cùng (tenant, event_id) ⇒ một dòng", async () => {
    expect(await emit(X, "dup:1", "contract.uploaded", "r-dup", {})).toBe(1);
    expect(await emit(X, "dup:1", "contract.uploaded", "r-dup", {})).toBe(0);
    const [n] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.flow_events where event_id = 'dup:1'`;
    expect(n?.n).toBe(1);
  });

  it("decides: chỉ flow khớp đầu theo position chạy; flow tắt không xét; điều kiện không khớp ghi lý do", async () => {
    launched.length = 0;
    await o`delete from hub.flow_events`;
    await emit(X, "sub:a", "contract.submitted", "r-a", { total_value: 50 });
    await emit(X, "sub:b", "contract.submitted", "r-b", { total_value: 5000 });
    await run();
    expect(launched.sort()).toEqual(["r-a|e1-chung", "r-b|e1-lon"]);
    const a = await row(X, "sub:a");
    expect(a?.processed).toBe(true);
    expect(a?.outcome?.skipped).toEqual([{ companyFlowId: cf["e1-lon"], reason: "not_matched" }]);
    const b = await row(X, "sub:b");
    expect(b?.outcome?.skipped).toEqual([
      { companyFlowId: cf["e1-chung"], reason: "decided_by_earlier", by: cf["e1-lon"] },
    ]);
  });

  it("decides (post.created) ⇒ 1 lượt; không decides (contract.uploaded) ⇒ mọi flow khớp", async () => {
    launched.length = 0;
    await emit(X, "post:1", "post.created", "p-1", {});
    await emit(X, "up:1", "contract.uploaded", "u-1", {});
    await run();
    expect(launched.sort()).toEqual(["p-1|e1-bai-a", "u-1|e1-tai-a", "u-1|e1-tai-b"]);
  });

  it("hai Hub chạy đồng thời ⇒ mỗi sự kiện × flow đúng một lần", async () => {
    launched.length = 0;
    for (let i = 0; i < 20; i++) await emit(X, `par:${i}`, "contract.uploaded", `par-${i}`, {});
    await Promise.all([run(), run()]);
    expect(launched.length).toBe(40);
    expect(new Set(launched).size).toBe(40);
  });

  it("cờ FLOW_TRIGGERS tắt (Y) ⇒ bóng: không mở lượt, ghi would_run", async () => {
    launched.length = 0;
    await emit(Y, "y:1", "contract.submitted", "y-1", {}, UY);
    await run();
    expect(launched).toEqual([]);
    const y = await row(Y, "y:1");
    expect(y?.processed).toBe(true);
    expect(y?.outcome).toMatchObject({ shadow: true, would_run: [cf["e1-y"]] });
  });

  it("lỗi tạm ⇒ thử lại sau lùi (chưa xong); lỗi cấu hình ⇒ refused, xong; quá 5 lần ⇒ lỗi, xong", async () => {
    await o`delete from hub.flow_events`;
    failNext = 1;
    await emit(X, "retry:1", "contract.uploaded", "rt-1", {});
    await run();
    let r = await row(X, "retry:1");
    expect([r?.processed, r?.attempts]).toEqual([false, 1]);
    expect(r?.error).toContain("tạm lỗi");
    await run(new Date(T0.getTime() + 31_000));
    r = await row(X, "retry:1");
    expect([r?.processed, r?.error]).toEqual([true, null]);

    await emit(X, "ref:1", "contract.approved", "rf-1", {});
    await run(new Date(T0.getTime() + 40_000));
    const rf = await row(X, "ref:1");
    expect(rf?.processed).toBe(true);
    expect(rf?.outcome?.refused).toEqual([
      { companyFlowId: cf["e1-refuse"], reason: "PROCESS_NOT_RUNNABLE" },
    ]);

    failNext = 1_000;
    await emit(X, "max:1", "contract.uploaded", "mx-1", {});
    for (let i = 0; i < 6; i++) await run(new Date(T0.getTime() + 3_600_000 * (i + 1)));
    failNext = 0;
    const mx = await row(X, "max:1");
    expect([mx?.processed, mx?.attempts]).toEqual([true, 5]);
    expect(mx?.error).toContain("tạm lỗi");
  });

  it("không có flow khớp ⇒ none, xong", async () => {
    await o`delete from hub.flow_events`;
    await emit(X, "none:1", "partner.join_requested", "n-1", {});
    await run();
    expect((await row(X, "none:1"))?.outcome).toMatchObject({ none: true });
  });
});

describe("CR-122 E1 · RLS chặn đọc chéo tenant", () => {
  it("scope user công ty Y không thấy flow_events / company_flows / tenant_flow_settings của X", async () => {
    await emit(X, "rls:1", "contract.uploaded", "rls-1", {});
    const seen = await withHubScope(db, { kind: "user", tenantId: Y, userId: UY }, async (tx) => {
      const n = async (t: string) =>
        (
          await tx.execute<{ n: number }>(
            sql.raw(`select count(*)::int as n from hub.${t} where tenant_id = '${X}'`),
          )
        )[0]?.n;
      return [await n("flow_events"), await n("company_flows"), await n("tenant_flow_settings")];
    });
    expect(seen).toEqual([0, 0, 0]);
    const own = await withHubScope(db, { kind: "user", tenantId: X, userId: UX }, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from hub.company_flows`),
    );
    expect(own[0]?.n).toBeGreaterThan(0);
  });

  it("scope user không ghi được cờ FLOW_TRIGGERS (chỉ system)", async () => {
    const err = await withHubScope(db, { kind: "user", tenantId: X, userId: UX }, (tx) =>
      setFlowTriggers(tx, X, false),
    ).then(
      () => null,
      (e) => e,
    );
    expect(err).not.toBeNull();
  });
});
