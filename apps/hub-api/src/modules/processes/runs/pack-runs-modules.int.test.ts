// CR-123 · u6 · FLOW3-FR-14 · đọc thật (role `hub_api`, scope user): run có cụm Ký số (gửi + chờ) ⇒ `stepsView` (nguồn của thẻ duyệt)
// trả MỘT bước "Ký số" với trạng thái nghiệp vụ theo kết quả của stage chờ; số hàng bước = số bước nghiệp vụ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ProcessDeps } from "../core/ports";
import { stepsView } from "./pack-runs-view";

let o: Sql;
let db: Db;
let close: () => Promise<void>;
let tid = "";
let uid = "";
let defId = "";

const SNAP = {
  key: "u6",
  name: "U6",
  trigger: { event: "contract.approved" },
  stages: [
    { key: "send", name: "Ký số", node: "contracts.esign", step: 0, executor: { kind: "tool" } },
    {
      key: "wait",
      name: "Chờ ký xong",
      node: "contracts.esign",
      step: 1,
      executor: {
        kind: "wait_event",
        event: "esign.completed",
        also_events: ["esign.declined", "esign.voided"],
        timeout_h: 168,
      },
    },
  ],
};

async function seed(wait: string, consumed: string | null): Promise<string> {
  const snap = structuredClone(SNAP) as typeof SNAP & {
    stages: { executor: { args?: unknown } }[];
  };
  (snap.stages[0] as { executor: { args?: unknown } }).executor.args = {
    company_signers: `user:${uid}`,
  };
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx, status)
    values (${tid}, ${defId}, 1, ${o.json(snap as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), 1, 1, 'waiting_timer') returning id`;
  const runId = r?.id as string;
  const ids: string[] = [];
  for (const [i, s] of ["done", wait].entries()) {
    const [x] = await o<
      { id: string }[]
    >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
      values (${tid}, ${runId}, ${i}, ${s}) returning id`;
    ids.push(x?.id as string);
  }
  if (consumed)
    await o`insert into hub.process_run_events (tenant_id, process_run_id, event, consumed_by)
      values (${tid}, ${runId}, ${consumed}, ${ids[1] as string})`;
  return runId;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [t] = (await tenants(o, 1, 1236)) as [string];
  tid = t;
  uid = (await users(o, tid, 1, { from: 123_600 }))[0] as string;
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, 'u6', 'u6', ${o.json([{ key: "send" }])}) returning id`;
  defId = d?.id as string;
  const client = postgres(urls().hubApi, { max: 2, onnotice: () => {} });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
}, 300_000);
afterAll(async () => {
  await close?.();
  await o?.end({ timeout: 2 });
});

const view = (runId: string) =>
  stepsView(
    { db, config: { user: async () => ({ groupIds: new Set<string>() }) } } as never as ProcessDeps,
    {
      userId: uid,
      tenantId: tid,
      role: "member",
    } as never,
    runId,
  );

describe("CR-123 · u6 · stepsView gộp cụm Ký số", () => {
  it.each([
    ["waiting_timer", null, "waiting"],
    ["done", "esign.completed", "done"],
    ["done", "esign.declined", "declined"],
    ["done", null, "expired"],
  ] as const)("chờ %s / sự kiện %s ⇒ MỘT dòng, trạng thái %s", async (wait, ev, outcome) => {
    const v = await view(await seed(wait, ev));
    expect(v?.steps).toHaveLength(1);
    expect(v?.steps[0]?.name).toBe("Ký số");
    // người ký cấu hình ở node ⇒ có tên
    expect(v?.steps[0]?.module).toEqual({
      node: "contracts.esign",
      outcome,
      signer: expect.any(String),
    });
  });
});
