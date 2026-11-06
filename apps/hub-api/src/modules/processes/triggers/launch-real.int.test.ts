// CR-122 · E1b · FLOW2-FR-19/20 · int với engine THẬT (`flowLaunchOf` → `StartService.createFromApi`, không launch giả): flow Thư viện
// được gán chạy thẳng bản xuất bản (không cần bản công ty); một sự kiện ⇒ đúng một lượt; gửi lại cùng event_id / mở lại sự kiện ⇒ vẫn
// một lượt (`process_runs_flow_event_uq`). Kèm soát E1: hết 5 lượt mà kẹt ⇒ `lease_exhausted`; dòng trỏ def công ty khác bị bỏ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { ProcessDeps } from "../core/ports";
import { dispatchOnce } from "./dispatcher";
import { insertFlowEvents } from "./dispatcher.repo";
import { setFlowTriggers } from "./flags";
import { flowLaunchOf } from "./flow-launch";

const X = tenantId(1261);
const Y = tenantId(1262);
const UX = userId(1261);
const T0 = new Date(Date.now() + 60_000);
let o: Sql;
let db: Db;
let lib = "";

const emit = (eventId: string, ref = "hd-1", t = X) =>
  withHubScope(db, { kind: "user", tenantId: t, userId: UX }, (tx) =>
    insertFlowEvents(tx, [
      { tenantId: t, eventId, event: "contract.uploaded", ref, facts: {}, actorId: UX },
    ]),
  );
const runsOf = async (eventId: string) =>
  (
    await o<{ n: number }[]>`select count(r.id)::int as n from hub.flow_events e
      left join hub.process_runs r on r.flow_event_id = e.id where e.event_id = ${eventId}`
  )[0]?.n;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1261', 'X'), (${Y}, 't1262', 'Y')`;
  await users(o, X, 1, { from: 1261 });
  const st = JSON.stringify([
    {
      key: "nhan",
      name: "Nhận",
      step: 0,
      executor: { kind: "set", values: [] },
      instruction: "",
      output: { filename: "n.md", template: "# n", required_sections: ["n"], fields: [] },
      after: { kind: "auto", branch: [] },
      real_action: false,
      answerer: { kind: "starter" },
      token_budget: null,
      outcome: "accepted",
    },
  ]);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app,
      published_version, enabled, slot) values (null, 'e1b-real', 'Nhận HĐ', ${st}::text::jsonb,
      '{"event":"contract.uploaded"}'::jsonb, 'contracts', 1, true, 'contracts.intake') returning id::text as id`;
  lib = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib}, 1, 'Nhận HĐ', ${st}::text::jsonb)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${X}, ${lib}, true)`;
  await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, X, true));
});
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const deps = () =>
  ({
    db,
    config: { user: async () => ({ active: true, groupIds: new Set<string>() }) },
    launcher: { kick: async () => {} },
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  }) as unknown as ProcessDeps;

describe("CR-122 E1b · mở lượt thật từ sự kiện", () => {
  it("flow Thư viện được gán: một sự kiện ⇒ một lượt (snapshot bản xuất bản), gửi lại / mở lại ⇒ vẫn một", async () => {
    const launch = flowLaunchOf(deps());
    await emit("real:1");
    const s = await dispatchOnce({ db, launch, now: () => T0 });
    expect(s).toMatchObject({ claimed: 1, launched: 1, failed: 0 });
    expect(await runsOf("real:1")).toBe(1);
    const [run] = await o<
      { def: string; pk: string | null }[]
    >`select r.process_def_id::text as def, r.pack_key as pk
      from hub.process_runs r join hub.flow_events e on e.id = r.flow_event_id where e.event_id = 'real:1'`;
    expect(run?.def).toBe(lib);
    expect(await emit("real:1")).toBe(0);
    await o`update hub.flow_events set processed_at = null, attempts = 0, next_at = now() where event_id = 'real:1'`;
    const again = await dispatchOnce({ db, launch, now: () => T0 });
    expect(again).toMatchObject({ claimed: 1, failed: 0 });
    expect(await runsOf("real:1")).toBe(1);
    const [e] = await o<
      { outcome: { ran: { runId: string | null }[] } }[]
    >`select outcome from hub.flow_events
      where event_id = 'real:1'`;
    expect(e?.outcome.ran.map((x) => x.runId)).toEqual([null]);
  });

  it("soát E1 #1: attempts = 5, lease đã qua, chưa xong ⇒ chốt lease_exhausted", async () => {
    await emit("stuck:1");
    await o`update hub.flow_events set attempts = 5, next_at = now() - interval '1 minute' where event_id = 'stuck:1'`;
    await dispatchOnce({ db, launch: async () => ({ runId: "x" }), now: () => T0 });
    const [r] = await o<
      { p: boolean; err: string | null }[]
    >`select processed_at is not null as p, error as err
      from hub.flow_events where event_id = 'stuck:1'`;
    expect(r).toEqual({ p: true, err: "lease_exhausted" });
  });

  it("soát E1 #2: dòng company_flows của X trỏ def thuộc Y ⇒ không là ứng viên", async () => {
    const [d] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
      values (${Y}, 'e1b-y', 'Y', '[{"key":"a"}]'::jsonb, '{"event":"contract.approved"}'::jsonb, 'contracts') returning id::text as id`;
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${X}, ${d?.id as string}, true)`;
    const seen: string[] = [];
    await withHubScope(db, { kind: "user", tenantId: X, userId: UX }, (tx) =>
      insertFlowEvents(tx, [
        {
          tenantId: X,
          eventId: "cross:1",
          event: "contract.approved",
          ref: "r",
          facts: {},
          actorId: UX,
        },
      ]),
    );
    await dispatchOnce({
      db,
      launch: async (_e, c) => {
        seen.push(c.defKey);
        return { runId: "x" };
      },
      now: () => T0,
    });
    expect(seen).toEqual([]);
    const [r] = await o<
      { outcome: { none: boolean } }[]
    >`select outcome from hub.flow_events where event_id = 'cross:1'`;
    expect(r?.outcome.none).toBe(true);
  });
});
