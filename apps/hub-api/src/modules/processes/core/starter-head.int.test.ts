// CR-139 · Q1 · «Trưởng phòng của người đề xuất» (`after.approver_mode = 'starter_head'`) — int (DB thật, role `hub_api`): mở việc
// duyệt ⇒ phân giải trưởng phòng của người gửi (leo phòng cha khi không trưởng / trưởng là người gửi), ghi vào snapshot run, giao
// đích danh; không ai ⇒ STARTER_HEAD_MISSING giao quản trị công ty (không treo); uỷ quyền; không lấy người tenant khác; def cũ như cũ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { department, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { insertTask } from "./core.repo";
import { resolveStarterHead } from "./starter-head.sql";
import { loadTaskDetails } from "./task-view";

let o: Sql;
let db: Db;
let T: string;
let T2: string;
let defId: string;
let defId2: string;
// P (trưởng HP) ← A (trưởng HA; S1, HA) ← C0 (không trưởng; N2). TA quản trị · X ngoài · D người được uỷ quyền. Q: tenant 2 không phòng.
let S1: string, HA: string, HP: string, N2: string, X: string, D: string, TA: string, Q: string;
const groupsOf = new Map<string, string[]>();
const MODE = { kind: "review", group_id: null, approver_mode: "starter_head" } as const;

async function openFor(starter: string, after: Record<string, unknown> = MODE, tenant = T) {
  const def = tenant === T ? defId : defId2;
  const snap = {
    key: "sh",
    name: "Đề xuất",
    token_budget: null,
    run_group_ids: [],
    stages: [{ key: "duyet", name: "Duyệt", step: 0, after }],
  };
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tenant}, ${starter}, 'c', 'c') returning id::text as id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx, status)
    values (${tenant}, ${def}, 1, ${o.json(snap as never)}, ${starter}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), 0, 0, 'waiting_review') returning id::text as id`;
  const runId = r?.id as string;
  const [s] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
    values (${tenant}, ${runId}, 0, 'waiting_review') returning id::text as id`;
  const stageRunId = s?.id as string;
  const taskId = await withHubScope(db, { kind: "system" }, (tx) =>
    insertTask(tx, {
      tenantId: tenant,
      runId,
      stageRunId,
      kind: "review",
      remindAt: new Date(Date.now() + 24 * 3_600_000),
      userIds: [],
      groupId: null,
    }),
  );
  return { runId, stageRunId, taskId };
}

const grants = (taskId: string) => o<
  { user_id: string | null; via: string; on_behalf_of: string | null }[]
>`
  select user_id::text, via, on_behalf_of::text from hub.review_task_assignees where task_id = ${taskId}
  order by via, user_id`;
const approverOfRun = async (runId: string) => {
  const [r] = await o<{ a: string | null }[]>`
    select snapshot->'stages'->0->'after'->>'approver_user_id' as a from hub.process_runs where id = ${runId}`;
  return r?.a ?? null;
};
const card = (u: string, taskId: string, role: "member" | "tenant_admin" = "member", tenant = T) =>
  withHubScope(db, { kind: "user", userId: u, tenantId: tenant }, async (tx) => {
    const [d] = await loadTaskDetails(
      tx,
      { userId: u, tenantId: tenant, role, groupIds: new Set(groupsOf.get(u) ?? []) },
      [taskId],
    );
    return d;
  });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  [T, T2] = (await tenants(o, 2, 1391)) as [string, string];
  [S1, HA, HP, N2, X, D] = (await users(o, T, 6, { from: 139_100 })) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  [TA] = (await users(o, T, 1, { from: 139_150, role: "tenant_admin" })) as [string];
  [Q] = (await users(o, T2, 1, { from: 139_200 })) as [string];
  const P = await department(o, T, "sh-p", { head: HP, members: [HP] });
  const A = await department(o, T, "sh-a", { head: HA, members: [S1, HA] });
  const C0 = await department(o, T, "sh-c0", { head: null, members: [N2] });
  await o`update admin.departments set parent_group_id = ${P} where group_id = ${A}`;
  await o`update admin.departments set parent_group_id = ${A} where group_id = ${C0}`;
  // tenant 2 có phòng có trưởng nhưng Q không thuộc phòng nào ⇒ không bao giờ lấy trưởng của tenant 1.
  for (const [u, g] of [
    [S1, [A]],
    [HA, [A]],
    [HP, [P]],
    [N2, [C0]],
  ] as const)
    groupsOf.set(u, [...g]);
  const mk = async (t: string, k: string) => {
    const [d] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages)
      values (${t}, ${k}, 'Đề xuất', ${o.json([{ key: "duyet", name: "Duyệt", step: 0, after: MODE }] as never)})
      returning id::text as id`;
    return d?.id as string;
  };
  defId = await mk(T, "sh-1391");
  defId2 = await mk(T2, "sh-1391b");
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-139 · Trưởng phòng của người đề xuất", () => {
  it("NV phòng A gửi ⇒ việc giao trưởng A (need='head'); người khác / trưởng phòng cha không quyết được", async () => {
    const { runId, taskId } = await openFor(S1);
    expect(await approverOfRun(runId)).toBe(HA);
    expect([...(await grants(taskId))]).toEqual([
      { user_id: HA, via: "initial", on_behalf_of: null },
    ]);
    const [n] = await o<{ need: string }[]>`select need from hub.review_tasks where id = ${taskId}`;
    expect(n?.need).toBe("head");
    expect((await card(HA, taskId))?.can_act).toBe(true);
    expect((await card(X, taskId))?.can_act ?? false).toBe(false);
    expect((await card(HP, taskId))?.can_act ?? false).toBe(false);
  });

  it("phòng không có trưởng ⇒ trưởng phòng cha", async () => {
    const { runId } = await openFor(N2);
    expect(await approverOfRun(runId)).toBe(HA);
  });

  it("trưởng phòng tự gửi ⇒ lên trưởng phòng cấp trên", async () => {
    const { runId } = await openFor(HA);
    expect(await approverOfRun(runId)).toBe(HP);
  });

  it("không ai (trưởng phòng gốc tự gửi) ⇒ STARTER_HEAD_MISSING: giao quản trị công ty, gỡ người duyệt cũ khỏi snapshot", async () => {
    const { runId, stageRunId, taskId } = await openFor(HP);
    expect(await approverOfRun(runId)).toBeNull();
    expect([...(await grants(taskId))]).toEqual([
      { user_id: TA, via: "escalated", on_behalf_of: null },
    ]);
    expect((await card(TA, taskId, "tenant_admin"))?.can_act).toBe(true);
    // mở lại sau khi đã ghi người duyệt (dữ liệu cũ) ⇒ ghi đè đúng, không giữ người cũ.
    await o`update hub.process_runs set snapshot = jsonb_set(snapshot, '{stages,0,after,approver_user_id}', ${o.json(X as never)})
      where id = ${runId}`;
    const head = await withHubScope(db, { kind: "system" }, (tx) =>
      resolveStarterHead(tx, T, stageRunId),
    );
    expect(head).toBeNull();
    expect(await approverOfRun(runId)).toBeNull();
  });

  it("uỷ quyền của trưởng A chuyển đúng người được uỷ quyền", async () => {
    await o`insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by)
      values (${T}, ${HA}, ${D}, now() - interval '1 hour', now() + interval '1 day', '{approve}', ${HA})`;
    try {
      const { taskId } = await openFor(S1);
      const g = await grants(taskId);
      expect(g.find((r) => r.via === "delegated")).toMatchObject({ user_id: D, on_behalf_of: HA });
      expect(await card(D, taskId)).toMatchObject({ can_act: true, delegated_from: { id: HA } });
    } finally {
      await o`delete from hub.delegations where from_user_id = ${HA}`;
    }
  });

  it("chéo tenant: người gửi tenant 2 không phòng ⇒ không lấy trưởng phòng tenant 1; tenant sai ⇒ không ghi gì", async () => {
    const { runId, stageRunId } = await openFor(Q, MODE, T2);
    expect(await approverOfRun(runId)).toBeNull();
    expect(
      await withHubScope(db, { kind: "system" }, (tx) => resolveStarterHead(tx, T2, stageRunId)),
    ).toBeNull();
    const own = await openFor(S1);
    const head = await withHubScope(db, { kind: "system" }, (tx) =>
      resolveStarterHead(tx, T2, own.stageRunId),
    );
    expect(head).toBeNull();
    expect(await approverOfRun(own.runId)).toBe(HA); // không đụng run tenant khác
  });

  it("hồi quy: bước không có kiểu mới (người duyệt cụ thể) chạy như cũ, snapshot không bị ghi", async () => {
    const { runId, taskId } = await openFor(S1, {
      kind: "review",
      group_id: null,
      approver_user_id: HP,
    });
    expect(await approverOfRun(runId)).toBe(HP);
    expect([...(await grants(taskId))]).toEqual([
      { user_id: HP, via: "initial", on_behalf_of: null },
    ]);
  });
});
