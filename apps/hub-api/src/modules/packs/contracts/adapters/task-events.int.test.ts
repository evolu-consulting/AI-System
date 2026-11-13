// [AUDIT] · lịch sử HĐ: nhận / trả / giao lại / tự trả / chuyển cấp ⇒ `task_handled` (theo lô, idempotent theo key, chéo tenant không ghi);
// quyết qua đường chung bằng Toàn quyền ⇒ hồ sơ `override`; bằng uỷ quyền ⇒ hồ sơ «thay <người uỷ quyền>» cả khi không có bằng chứng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackTaskEvent } from "../../kit/public";
import { recordEngineDecision, recordTaskEvents } from "../application/approval-decided.usecase";
import { approvalEngineRepo } from "./approval-engine.repo";
import { taskEventsRepo } from "./task-events.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let CREATOR = "";
let ACTOR = "";
let BOSS = "";
let CIDS: string[] = [];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T, T2] = (await tenants(o, 2, 1611)) as [string, string];
  [CREATOR, ACTOR, BOSS] = (await users(o, T, 3, { from: 1611 })) as [string, string, string];
  CIDS = await contracts(o, T, 3, { from: 1611, createdBy: CREATOR, status: "draft" });
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approvalEngine: approvalEngineRepo(tx, tid),
    taskEvents: taskEventsRepo(tx, tid),
  }));
async function engineApproval(cid: string) {
  const aid = crypto.randomUUID();
  const run = crypto.randomUUID();
  await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, engine_run_id)
    values (${aid}, ${T}, ${cid}, 'level1', ${CREATOR}, 'engine', ${run})`;
  await o`update contracts.contracts set run_id = ${aid} where id = ${cid}`;
  return { aid, run };
}
const AT = "2026-11-13T01:02:03.000Z";
const evt = (
  run: string,
  task: string,
  kind: PackTaskEvent["kind"],
  tenantId = T,
): PackTaskEvent => ({
  tenantId,
  taskId: task,
  kind,
  actor: kind === "escalate" || kind === "auto_release" ? null : ACTOR,
  to: kind === "reassign" ? BOSS : null,
  reason: kind === "escalate" ? "overdue" : null,
  at: AT,
  runId: run,
  stageKey: "truong-phong",
  key: `${task}:${kind}:${AT}`,
});
const rows = async (cid: string) =>
  [
    ...(await o`select actor_user_id::text as actor, data ->> 'kind' as kind, data ->> 'stage' as stage,
        data ->> 'to' as to
      from contracts.contract_events where contract_id = ${cid} and type = 'task_handled' order by id`),
  ].map((r) => `${r.kind}:${r.actor ?? "system"}:${r.stage}:${r.to ?? ""}`);

describe("[AUDIT] việc trên bước duyệt ⇒ lịch sử HĐ", () => {
  it("nhận / trả / giao lại / tự trả / chuyển cấp ⇒ mỗi loại một dòng; gửi lại cùng lô ⇒ không trùng", async () => {
    const cid = CIDS[0] as string;
    const { run } = await engineApproval(cid);
    const t = crypto.randomUUID();
    const kinds = ["claim", "release", "reassign", "auto_release", "escalate"] as const;
    const lot = kinds.map((k) => evt(run, t, k));
    await recordTaskEvents(uow())(lot);
    await recordTaskEvents(uow())(lot);
    // cùng `at` ⇒ thứ tự chèn không định nghĩa: so tập
    expect((await rows(cid)).sort()).toEqual(
      [
        `claim:${ACTOR}:truong-phong:`,
        `release:${ACTOR}:truong-phong:`,
        `reassign:${ACTOR}:truong-phong:${BOSS}`,
        "auto_release:system:truong-phong:",
        "escalate:system:truong-phong:",
      ].sort(),
    );
  });

  it("chéo tenant: run của tenant A báo với tenant B ⇒ không ghi", async () => {
    const cid = CIDS[1] as string;
    const { run } = await engineApproval(cid);
    await recordTaskEvents(uow())([evt(run, crypto.randomUUID(), "claim", T2)]);
    expect(await rows(cid)).toEqual([]);
  });

  it("đường chung: Toàn quyền ⇒ override; uỷ quyền không bằng chứng ⇒ hồ sơ có on_behalf_of", async () => {
    const cid = CIDS[2] as string;
    const { run } = await engineApproval(cid);
    const base = {
      tenantId: T,
      packKey: "contracts",
      runId: run,
      stageKey: "s0",
      feedback: null,
      evidenceId: null,
    };
    const hook = recordEngineDecision(uow());
    await hook({
      ...base,
      taskId: crypto.randomUUID(),
      result: "pass",
      actor: BOSS,
      override: true,
    });
    await hook({
      ...base,
      taskId: crypto.randomUUID(),
      result: "fail",
      actor: ACTOR,
      onBehalfOf: CREATOR,
    });
    const got = await uow().system(
      T,
      async (r) => (await r.approvalEngine.decisionsOf?.(cid)) ?? [],
    );
    expect(got.map((x) => [x.action, x.actor, x.override, x.onBehalfOf ?? null])).toEqual([
      ["approve", BOSS, true, null],
      ["return", ACTOR, false, CREATOR],
    ]);
  });
});
