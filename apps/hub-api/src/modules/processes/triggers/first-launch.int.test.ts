// CR-122 · P4 · lỗi #4 (qc q1-e2e) · "HĐ đầu tiên sau khi gán flow không mở lượt": gán flow → bật cờ → sự kiện ĐẦU TIÊN ⇒ đúng một lượt
// ngay trong MỘT lần `dispatchOnce`, kể cả khi cache cấu hình (catalog tính năng) còn ảnh cũ lúc sự kiện tới — trước sửa, node có
// tính năng bị coi "tắt" theo ảnh cũ ⇒ `FlowLaunchRefused` (kết cục cuối, không thử lại) ⇒ HĐ đầu mất lượt mãi mãi.
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

const X = tenantId(1281);
const UX = userId(1281);
const FEATURE_ID = "f-contracts-write";
const T0 = new Date(Date.now() + 60_000);
let o: Sql;
let db: Db;
let lib = "";
let cacheFresh = false; // false = catalog cache còn ảnh cũ (chưa có entitlement); poll() ⇒ nạp lại

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1281', 'X')`;
  await users(o, X, 1, { from: 1281 });
  const st = JSON.stringify([
    {
      key: "ky",
      name: "Ký",
      node: "contracts.esign",
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
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version, enabled)
    values (null, 'p4-first', 'Ký HĐ', ${st}::text::jsonb, '{"event":"contract.uploaded"}'::jsonb, 'contracts', 1, true)
    returning id::text as id`;
  lib = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib}, 1, 'Ký HĐ', ${st}::text::jsonb)`;
});
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const config = () => ({
  user: async () => ({ active: true, groupIds: new Set<string>() }),
  adminSettled: async () => {},
  poll: async () => {
    cacheFresh = true;
  },
  catalog: async () => ({
    features: [{ id: FEATURE_ID, key: "contracts-write", status: "on" }],
    entitled: new Set(cacheFresh ? [`${X}:${FEATURE_ID}`] : []),
    grantGroups: new Map(),
  }),
});
const deps = () =>
  ({
    db,
    config: config(),
    launcher: { kick: async () => {} },
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  }) as unknown as ProcessDeps;

describe("CR-122 P4 · #4 sự kiện đầu tiên sau khi gán flow", () => {
  it("gán → bật cờ → sự kiện đầu ⇒ đúng 1 lượt trong một dispatchOnce (cache cấu hình cũ không làm mất lượt)", async () => {
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${X}, ${lib}, true)`;
    await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, X, true));
    await withHubScope(db, { kind: "user", tenantId: X, userId: UX }, (tx) =>
      insertFlowEvents(tx, [
        {
          tenantId: X,
          eventId: "first:1",
          event: "contract.uploaded",
          ref: "hd-1",
          facts: {},
          actorId: UX,
        },
      ]),
    );
    const s = await dispatchOnce({ db, launch: flowLaunchOf(deps()), now: () => T0 });
    expect(s).toMatchObject({ claimed: 1, launched: 1, failed: 0 });
    const [n] = await o<{ n: number }[]>`select count(r.id)::int as n from hub.flow_events e
      join hub.process_runs r on r.flow_event_id = e.id where e.event_id = 'first:1'`;
    expect(n?.n).toBe(1);
  });
});
