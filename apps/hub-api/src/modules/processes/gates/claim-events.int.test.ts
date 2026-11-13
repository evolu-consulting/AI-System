// [AUDIT] · Nhận việc / Trả về nhóm trên run gắn gói ⇒ engine báo gói (`packTaskEvents`) đúng loại + bước, người làm ≠ người gửi;
// task của tenant khác ⇒ không báo. Toàn quyền (chỉ nhờ Group «cũng quyết») quyết qua đường chung ⇒ `packDecided.override = true`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { PackDecidedEvent, PackTaskEvent, ProcessDeps } from "../core/ports";
import { emitPackTaskEvents } from "../runs/pack-task-events";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { ClaimService } from "./claim.service";
import { GateService } from "./gates.service";

let o: Sql;
let db: Db;
let w: ClaimWorld;
let T2 = "";

type Seen = { ev: PackTaskEvent[]; dec: PackDecidedEvent[] };
const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function deps(seen: Seen, extra = new Map<string, string[]>()): ProcessDeps {
  return {
    db,
    config: {
      user: async (uid: string) => ({
        active: true,
        groupIds: new Set([...(w.groupsOf.get(uid) ?? []), ...(extra.get(uid) ?? [])]),
      }),
    },
    redis: { pipeline: () => pipe },
    notifier: new Proxy({}, { get: () => async () => [] }),
    launcher: { kick: async () => {} },
    postThread: async () => {},
    now: () => new Date(),
    log: { warn: () => {}, info: () => {}, error: () => {} },
    packTaskEvents: async (_p: string, rows: PackTaskEvent[]) => {
      seen.ev.push(...rows);
    },
    packDecided: async (e: PackDecidedEvent) => {
      seen.dec.push(e);
    },
  } as unknown as ProcessDeps;
}
const who = (userId: string) => ({ userId, tenantId: w.T, role: "member" }) as never;
async function packTask(after?: Record<string, unknown>) {
  const t = await groupTask(o, w, w.G0, after);
  await o.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update hub.process_runs set pack_key = 'contracts', pack_record_id = gen_random_uuid()
      where id = ${t.runId}`;
  });
  return t;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1631);
  [T2] = (await tenants(o, 1, 1632)) as [string];
  db = connectDb(urls().hubApi, 4);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("[AUDIT] việc trên task duyệt ⇒ báo gói", () => {
  it("A nhận việc rồi trả về nhóm ⇒ 2 sự kiện claim, release (bước `duyet`, người làm A)", async () => {
    const { taskId, runId } = await packTask();
    const seen: Seen = { ev: [], dec: [] };
    const svc = new ClaimService(deps(seen));
    await svc.claim(who(w.A), taskId);
    await svc.release(who(w.A), taskId);
    expect(seen.ev.map((e) => [e.kind, e.actor, e.stageKey, e.runId, e.taskId])).toEqual([
      ["claim", w.A, "duyet", runId, taskId],
      ["release", w.A, "duyet", runId, taskId],
    ]);
  });

  it("chéo tenant: task của tenant A gửi kèm tenant B ⇒ không báo", async () => {
    const { taskId } = await packTask();
    const seen: Seen = { ev: [], dec: [] };
    const at = new Date().toISOString();
    const base = {
      taskId,
      kind: "escalate" as const,
      actor: null,
      to: null,
      reason: "overdue",
      at,
    };
    await emitPackTaskEvents(deps(seen), [{ ...base, tenantId: T2 }]);
    expect(seen.ev).toEqual([]);
  });

  it("X chỉ có quyền nhờ Group «cũng quyết» ⇒ quyết qua đường chung mang override = true", async () => {
    const ALSO = w.G;
    const { taskId } = await packTask({ kind: "review", group_id: null, also_group_ids: [ALSO] });
    const seen: Seen = { ev: [], dec: [] };
    const svc = new GateService(deps(seen, new Map([[w.X, [ALSO]]])));
    await svc.reviewDecision(who(w.X), taskId, { result: "pass" } as never);
    expect(seen.dec.map((e) => [e.actor, e.override === true])).toEqual([[w.X, true]]);
  });
});
