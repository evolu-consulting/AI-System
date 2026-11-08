// CR-125 · purchase-flow G3 · «A + B cùng duyệt» (đường thật, role `hub_api`): bước Duyệt có `after.parallel` mở MỘT thẻ mỗi nhóm cùng
// lúc (kick launcher thật) ⇒ quyết qua `GateService.reviewDecision` (cổng kiểm thật, khoá run) ⇒ kiểm trạng thái người dùng thấy
// (`stepsView` = thẻ HĐ/getApproval, `openTasksOf` = "Chờ tôi duyệt") chứ không chỉ dòng DB (Luật 0d.10).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { department, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { registerOutcomeHandler, unregisterFlowPorts } from "../adapters/runs/flow-ports";
import type { ProcessDeps } from "../core/ports";
import { createStageLauncher } from "../runs/launcher";
import { openTasksOf, stepsView } from "../runs/pack-runs-view";
import { GateService } from "./gates.service";
import { PARALLEL_CLOSED_BY_DECISION, PARALLEL_CLOSED_BY_QUORUM } from "./parallel-approve";

const PACK = "partest";
const EVENT = "partest.submitted";
let o: Sql;
let db: Db;
let T = "";
let S = ""; // người gửi
let A = "";
let B = "";
let C = "";
const G: Record<string, string> = {};
const groupsOf = new Map<string, string[]>();
const applied: string[] = [];

const base = (key: string, name: string, step: number) => ({
  key,
  name,
  step,
  instruction: "",
  output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
});
const end = (key: string, step: number, outcome: string) => ({
  ...base(key, key, step),
  executor: { kind: "set", values: [] },
  after: { kind: "auto", branch: [] },
  outcome,
});
type Rule = "all" | "any" | { min: number };
/** 0 Duyệt cùng lúc (Trả lại → 2) · 1 Kết thúc approved · 2 Kết thúc returned. Từ chối không đích ⇒ huỷ lượt. */
const snap = (rule: Rule, keys: string[]) => ({
  key: "par",
  name: "Par",
  trigger: { event: EVENT },
  token_budget: null,
  stages: [
    {
      ...base("duyet", "Trưởng bộ phận + Tài chính", 0),
      executor: { kind: "approve", reject_step: null, return_step: 2 },
      after: {
        kind: "review",
        group_id: null,
        back_to_steps: [],
        remind_every_h: null,
        escalate: null,
        branch: [],
        exclude_starter: false,
        parallel: { groups: keys.map((k) => ({ group_id: G[k], label: k })), rule },
      },
    },
    end("ok", 1, "approved"),
    end("back", 2, "returned"),
  ],
});

const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function deps(): ProcessDeps {
  const d = {
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set(groupsOf.get(uid) ?? []) }),
      poll: async () => {},
      catalog: async () => ({ features: [], entitled: new Set(), grantGroups: new Map() }),
    },
    redis: { pipeline: () => pipe },
    notifier: new Proxy({}, { get: () => async () => [] }),
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps & { launcher: unknown };
  d.launcher = createStageLauncher(d as never);
  return d;
}

async function startRun(rule: Rule, keys: string[]): Promise<string> {
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${T}, ${S}, 'c', 'c') returning id`;
  const sn = snap(rule, keys);
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${T}, ${`par-${crypto.randomUUID().slice(0, 8)}`}, 'par', ${o.json(sn.stages as never)}) returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx,
      pack_key, pack_record_id, status)
    values (${T}, ${d?.id as string}, 1, ${o.json(sn as never)}, ${S}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), 0, 0, ${PACK}, gen_random_uuid(), 'running') returning id`;
  const runId = r?.id as string;
  for (const [i, st] of ["queued", "pending", "pending"].entries())
    await o`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status) values (${T}, ${runId}, ${i}, ${st})`;
  await deps().launcher.kick(runId);
  return runId;
}

type TaskRow = {
  id: string;
  group: string;
  status: string;
  result: string | null;
  feedback: string | null;
};
const tasksOf = async (runId: string): Promise<Record<string, TaskRow>> => {
  const rows = await o<
    TaskRow[]
  >`select t.id::text, t.assignee_group_id::text as group, t.status, t.result, t.feedback
    from hub.review_tasks t where t.process_run_id = ${runId} and t.kind = 'review'`;
  const byKey = Object.fromEntries(Object.entries(G).map(([k, v]) => [v, k]));
  return Object.fromEntries(rows.map((r) => [byKey[r.group] as string, r]));
};
const stateOf = async (runId: string) => {
  const [r] = await o<{ run: string; s0: string; decision: string | null }[]>`
    select r.status as run, s.status as s0, po.fields->>'decision' as decision from hub.process_runs r
    join hub.stage_runs s on s.process_run_id = r.id and s.stage_idx = 0
    left join hub.process_outputs po on po.id = s.current_output_id where r.id = ${runId}`;
  return r;
};
const who = (userId: string) => ({ userId, tenantId: T, role: "member" as const });
const decide = (u: string, taskId: string, result: "pass" | "reject" | "fail") =>
  new GateService(deps()).reviewDecision(who(u), taskId, {
    result,
    ...(result === "pass" ? {} : { feedback: "không đồng ý" }),
  } as never);
const myStep = async (u: string, runId: string) =>
  (await stepsView(deps(), who(u), runId))?.steps[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 1251)) as [string];
  [S, A, B, C] = (await users(o, T, 4, { from: 125_100 })) as [string, string, string, string];
  for (const [k, u] of [
    ["pb-truong", A],
    ["pb-tai-chinh", B],
    ["pb-phap-che", C],
  ] as const) {
    G[k] = await department(o, T, k, { head: u, members: [u] });
    groupsOf.set(u, [G[k] as string]);
  }
  db = connectDb(urls().hubApi, 6);
  registerOutcomeHandler({
    packKey: PACK,
    events: [EVENT],
    async apply(_tx, input) {
      applied.push(`${input.runId}:${input.outcome}`);
      return "applied";
    },
  });
}, 300_000);
afterAll(async () => {
  unregisterFlowPorts(PACK);
  await db?.close();
  await o?.end({ timeout: 2 });
});

const TWO = ["pb-truong", "pb-tai-chinh"];
const THREE = ["pb-truong", "pb-tai-chinh", "pb-phap-che"];

describe("CR-125 · «A + B cùng duyệt» (đường thật)", () => {
  it("mở thẻ cho mọi nhóm cùng lúc — mỗi nhóm thấy và quyết được thẻ CỦA MÌNH (thẻ HĐ + Chờ tôi duyệt)", async () => {
    const runId = await startRun("all", TWO);
    const t = await tasksOf(runId);
    expect([t["pb-truong"]?.status, t["pb-tai-chinh"]?.status]).toEqual(["open", "open"]);
    expect(await myStep(A, runId)).toMatchObject({
      status: "open",
      task: { id: t["pb-truong"]?.id, can_act: true },
    });
    expect(await myStep(B, runId)).toMatchObject({
      task: { id: t["pb-tai-chinh"]?.id, can_act: true },
    });
    const inboxA = await openTasksOf(deps(), who(A), PACK);
    const inboxB = await openTasksOf(deps(), who(B), PACK);
    expect(inboxA.filter((x) => x.run_id === runId).map((x) => x.task_id)).toEqual([
      t["pb-truong"]?.id as string,
    ]);
    expect(inboxB.filter((x) => x.run_id === runId).map((x) => x.task_id)).toEqual([
      t["pb-tai-chinh"]?.id as string,
    ]);
  });

  it("all: A Đạt ⇒ bước còn chờ B (A không còn quyết) — B Đạt ⇒ bước Đạt, lượt xong", async () => {
    const runId = await startRun("all", TWO);
    const t = await tasksOf(runId);
    await decide(A, t["pb-truong"]?.id as string, "pass");
    expect(await stateOf(runId)).toMatchObject({ run: "waiting_review", s0: "waiting_review" });
    expect(await myStep(A, runId)).toMatchObject({ status: "open", task: { can_act: false } });
    expect(await myStep(B, runId)).toMatchObject({
      task: { id: t["pb-tai-chinh"]?.id, can_act: true },
    });
    await decide(B, t["pb-tai-chinh"]?.id as string, "pass");
    expect(await stateOf(runId)).toMatchObject({ run: "done", s0: "done", decision: "approved" });
    const after = await tasksOf(runId);
    expect([after["pb-truong"]?.result, after["pb-tai-chinh"]?.result]).toEqual(["pass", "pass"]);
    expect(applied).toContain(`${runId}:approved`);
  });

  it("all: A Đạt, B Từ chối ⇒ bước Từ chối (lượt huỷ), không chạy Kết thúc · Đã duyệt", async () => {
    const runId = await startRun("all", TWO);
    const t = await tasksOf(runId);
    await decide(A, t["pb-truong"]?.id as string, "pass");
    await decide(B, t["pb-tai-chinh"]?.id as string, "reject");
    expect(await stateOf(runId)).toMatchObject({ run: "cancelled", decision: "rejected" });
    expect(applied).not.toContain(`${runId}:approved`);
    expect(await myStep(A, runId)).toMatchObject({ task: null });
  });
});

describe("CR-125 · «A + B cùng duyệt» (đường thật) · any, min", () => {
  it("any: một nhóm Đạt ⇒ bước Đạt ngay — thẻ nhóm kia đóng với lý do", async () => {
    const runId = await startRun("any", TWO);
    const t = await tasksOf(runId);
    await decide(B, t["pb-tai-chinh"]?.id as string, "pass");
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "approved" });
    expect((await tasksOf(runId))["pb-truong"]).toMatchObject({
      status: "closed",
      result: "superseded",
      feedback: PARALLEL_CLOSED_BY_QUORUM,
    });
    await expect(decide(A, t["pb-truong"]?.id as string, "pass")).rejects.toMatchObject({
      code: "REVIEW_TASK_CLOSED",
    });
  });
});

describe("CR-125 · «A + B cùng duyệt» (đường thật) · min", () => {
  it("min 2/3: A Đạt ⇒ chờ — B Đạt ⇒ Đạt — thẻ C đóng", async () => {
    const runId = await startRun({ min: 2 }, THREE);
    const t = await tasksOf(runId);
    await decide(A, t["pb-truong"]?.id as string, "pass");
    expect(await stateOf(runId)).toMatchObject({ s0: "waiting_review" });
    expect(await myStep(C, runId)).toMatchObject({
      task: { id: t["pb-phap-che"]?.id, can_act: true },
    });
    await decide(B, t["pb-tai-chinh"]?.id as string, "pass");
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "approved" });
    expect((await tasksOf(runId))["pb-phap-che"]).toMatchObject({
      status: "closed",
      result: "superseded",
    });
  });

  it("min 2/3: A Đạt, B Từ chối ⇒ Từ chối ngay — thẻ C đóng «Đã có người từ chối/trả lại»", async () => {
    const runId = await startRun({ min: 2 }, THREE);
    const t = await tasksOf(runId);
    await decide(A, t["pb-truong"]?.id as string, "pass");
    await decide(B, t["pb-tai-chinh"]?.id as string, "reject");
    expect(await stateOf(runId)).toMatchObject({ run: "cancelled", decision: "rejected" });
    expect((await tasksOf(runId))["pb-phap-che"]).toMatchObject({
      status: "closed",
      feedback: PARALLEL_CLOSED_BY_DECISION,
    });
    expect(await myStep(C, runId)).toMatchObject({ task: null });
  });

  it("Trả lại (một nhóm) ⇒ tới bước Trả lại — thẻ nhóm kia đóng với lý do", async () => {
    const runId = await startRun("all", TWO);
    const t = await tasksOf(runId);
    await decide(A, t["pb-truong"]?.id as string, "fail");
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "returned" });
    expect(applied).toContain(`${runId}:returned`);
    expect((await tasksOf(runId))["pb-tai-chinh"]).toMatchObject({
      status: "closed",
      feedback: PARALLEL_CLOSED_BY_DECISION,
    });
  });
});

describe("CR-125 · «A + B cùng duyệt» (đường thật) · đồng thời", () => {
  it("hai người quyết CÙNG LÚC (any) ⇒ một người thắng, bước chuyển MỘT lần", async () => {
    const runId = await startRun("any", TWO);
    const t = await tasksOf(runId);
    const out = await Promise.allSettled([
      decide(A, t["pb-truong"]?.id as string, "pass"),
      decide(B, t["pb-tai-chinh"]?.id as string, "pass"),
    ]);
    expect(out.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = out.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "REVIEW_TASK_CLOSED" });
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "approved" });
    const results = Object.values(await tasksOf(runId)).map((x) => x.result);
    expect(results.sort()).toEqual(["pass", "superseded"]);
    expect(applied.filter((x) => x === `${runId}:approved`)).toHaveLength(1);
  });

  it("all: hai người Đạt CÙNG LÚC ⇒ cả hai phiếu ghi nhận, bước Đạt MỘT lần", async () => {
    const runId = await startRun("all", TWO);
    const t = await tasksOf(runId);
    const out = await Promise.allSettled([
      decide(A, t["pb-truong"]?.id as string, "pass"),
      decide(B, t["pb-tai-chinh"]?.id as string, "pass"),
    ]);
    expect(out.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "approved" });
    expect(applied.filter((x) => x === `${runId}:approved`)).toHaveLength(1);
  });
});
