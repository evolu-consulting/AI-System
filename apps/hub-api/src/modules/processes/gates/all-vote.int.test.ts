// CR-127 · E5 · spec §5.4 · R#13 · R#14 · Q12 · "Cần: tất cả" (đường thật, role `hub_api`): bước Duyệt `after.need='all'` mở MỘT thẻ, mỗi
// thành viên phòng (trừ người gửi) một phiếu (`hub.review_task_votes`) ⇒ quyết qua `GateService.reviewDecision` (cổng thật, khoá run) ⇒ kiểm
// thứ người dùng thấy (thẻ việc `votes`/`can_act`) + trạng thái run, không chỉ dòng DB (Luật 0d.10). Khác CR-125 «A + B cùng duyệt».
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { department, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../lib/db";
import { registerOutcomeHandler, unregisterFlowPorts } from "../adapters/runs/flow-ports";
import type { ProcessDeps } from "../core/ports";
import { loadTaskDetails } from "../core/task-view";
import { createStageLauncher } from "../runs/launcher";
import { GateService } from "./gates.service";

const PACK = "alltest";
const EVENT = "alltest.submitted";
let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let S = ""; // người gửi (cũng là thành viên phòng)
let A = "";
let B = "";
let C = "";
let D = ""; // người được A uỷ quyền (ngoài phòng)
let X = ""; // "Quá hạn chuyển cho"
let M = ""; // quản trị công ty
let J = ""; // vào phòng sau khi mở thẻ
let Z = ""; // người tenant khác
let GALL = "";
let GSOLO = "";
const groupsOf = new Map<string, string[]>();
const applied: string[] = [];

const base = (key: string, step: number) => ({
  key,
  name: key,
  step,
  instruction: "",
  output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
});
const end = (key: string, step: number, outcome: string) => ({
  ...base(key, step),
  executor: { kind: "set", values: [] },
  after: { kind: "auto", branch: [] },
  outcome,
});
type Esc = { after_h: number; user_id?: string } | null;
/** 0 Duyệt "Cần: tất cả" (Trả lại → 2) · 1 Kết thúc approved · 2 Kết thúc returned. */
const snap = (group: string, escalate: Esc) => ({
  key: "all",
  name: "All",
  trigger: { event: EVENT },
  token_budget: null,
  stages: [
    {
      ...base("duyet", 0),
      executor: { kind: "approve", reject_step: null, return_step: 2 },
      after: {
        kind: "review",
        group_id: group,
        back_to_steps: [],
        remind_every_h: null,
        escalate,
        branch: [],
        exclude_starter: false,
        need: "all",
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

async function startRun(
  group: string,
  escalate: Esc = null,
): Promise<{ runId: string; task: string }> {
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${T}, ${S}, 'c', 'c') returning id`;
  const sn = snap(group, escalate);
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${T}, ${`all-${crypto.randomUUID().slice(0, 8)}`}, 'all', ${o.json(sn.stages as never)}) returning id`;
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
  const [t] = await o<{ id: string }[]>`select id::text from hub.review_tasks
    where process_run_id = ${runId} and kind = 'review' and status = 'open'`;
  return { runId, task: t?.id as string };
}

const stateOf = async (runId: string) => {
  const [r] = await o<{ run: string; s0: string; decision: string | null }[]>`
    select r.status as run, s.status as s0, po.fields->>'decision' as decision from hub.process_runs r
    join hub.stage_runs s on s.process_run_id = r.id and s.stage_idx = 0
    left join hub.process_outputs po on po.id = s.current_output_id where r.id = ${runId}`;
  return r;
};
const votesOf = (task: string) =>
  o<{ user_id: string; on_behalf_of: string | null; result: string; evidence_id: string | null }[]>`
    select user_id::text, on_behalf_of::text, result, evidence_id::text from hub.review_task_votes
    where task_id = ${task} order by at`;
const grantsOf = (task: string) =>
  o<{ user_id: string | null; group_id: string | null; via: string }[]>`
    select user_id::text, group_id::text, via from hub.review_task_assignees where task_id = ${task} order by user_id`;
const who = (userId: string, tenantId = T) => ({ userId, tenantId, role: "member" as const });
type Res = "pass" | "fail" | "reject";
const decide = (u: string, task: string, result: Res, extra: Record<string, unknown> = {}) =>
  new GateService(deps()).reviewDecision(who(u) as never, task, {
    result,
    ...(result === "pass" ? {} : { feedback: "chưa ổn" }),
    ...extra,
  } as never);
const card = (u: string, task: string) =>
  withHubScope(db, { kind: "user", userId: u, tenantId: T }, async (tx) => {
    const [d] = await loadTaskDetails(tx, { ...who(u), groupIds: new Set(groupsOf.get(u) ?? []) }, [
      task,
    ]);
    return d;
  });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T, T2] = (await tenants(o, 2, 1271)) as [string, string];
  const us = await users(o, T, 7, { from: 127_100 });
  [S, A, B, C, D, X, J] = us as [string, string, string, string, string, string, string];
  [M] = (await users(o, T, 1, { from: 127_200, role: "tenant_admin" })) as [string];
  [Z] = (await users(o, T2, 1, { from: 127_300 })) as [string];
  GALL = await department(o, T, "e5-all", { head: null, members: [S, A, B, C] });
  GSOLO = await department(o, T, "e5-solo", { head: null, members: [S] });
  for (const u of [S, A, B, C]) groupsOf.set(u, [GALL]);
  groupsOf.set(S, [GALL, GSOLO]);
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

const NOT_FOUND = { code: "PROCESS_NOT_FOUND" };
const CLOSED = { code: "REVIEW_TASK_CLOSED" };

describe("CR-127 · E5 · Cần: tất cả", () => {
  it("n/n: mỗi thành viên (trừ người gửi) một phiếu; chưa đủ ⇒ thẻ mở x/n; đủ ⇒ bước Đạt; bỏ phiếu lần hai ⇒ 409", async () => {
    const { runId, task } = await startRun(GALL);
    const g = await grantsOf(task);
    expect(
      g
        .filter((x) => x.via === "initial")
        .map((x) => x.user_id)
        .sort(),
    ).toEqual([A, B, C].sort());
    expect(g.some((x) => x.group_id !== null)).toBe(false);
    expect(await card(B, task)).toMatchObject({
      need: "all",
      votes: { done: 0, total: 3 },
      can_act: true,
    });
    const a = await decide(A, task, "pass");
    expect(a).toMatchObject({ status: "open", votes: { done: 1, total: 3 }, can_act: false });
    expect(await stateOf(runId)).toMatchObject({ s0: "waiting_review" });
    await expect(decide(A, task, "pass")).rejects.toMatchObject(CLOSED);
    await expect(decide(S, task, "pass")).rejects.toMatchObject(NOT_FOUND); // người gửi không có phiếu
    await decide(B, task, "pass");
    expect(await stateOf(runId)).toMatchObject({ s0: "waiting_review" });
    await decide(C, task, "pass");
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "approved" });
    expect((await votesOf(task)).map((v) => [v.user_id, v.result])).toEqual([
      [A, "pass"],
      [B, "pass"],
      [C, "pass"],
    ]);
    expect(applied.filter((x) => x === `${runId}:approved`)).toHaveLength(1);
  });

  it("một người Trả lại ⇒ bước Trả lại ngay (dù đã có phiếu Duyệt); phiếu giữ nguyên", async () => {
    const { runId, task } = await startRun(GALL);
    await decide(A, task, "pass");
    await decide(B, task, "fail");
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "returned" });
    expect((await votesOf(task)).map((v) => v.result)).toEqual(["pass", "fail"]);
    await expect(decide(C, task, "pass")).rejects.toMatchObject(CLOSED);
  });

  it("một người Từ chối ⇒ lượt huỷ", async () => {
    const { runId, task } = await startRun(GALL);
    await decide(C, task, "reject");
    expect(await stateOf(runId)).toMatchObject({ run: "cancelled", decision: "rejected" });
  });

  it("người bị vô hiệu sau khi mở thẻ ⇒ loại khỏi n ở phiếu kế tiếp", async () => {
    const { runId, task } = await startRun(GALL);
    await decide(A, task, "pass");
    await o`update admin.users set active = false where id = ${C}`;
    try {
      expect(await card(B, task)).toMatchObject({ votes: { done: 1, total: 2 } });
      await decide(B, task, "pass");
      expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "approved" });
    } finally {
      await o`update admin.users set active = true where id = ${C}`;
    }
  });

  it("thành viên vào phòng sau khi mở thẻ không có phiếu (404); tenant khác không quyết, không đọc được phiếu", async () => {
    const { task } = await startRun(GALL);
    await decide(A, task, "pass");
    await members(o, T, GALL, [J]);
    groupsOf.set(J, [GALL]);
    await expect(decide(J, task, "pass")).rejects.toMatchObject(NOT_FOUND);
    expect(await card(J, task)).toMatchObject({ can_act: false });
    await o`delete from admin.group_members where user_id = ${J}`; // các ca sau: tập bỏ phiếu không gồm J
    await expect(
      new GateService(deps()).reviewDecision(who(Z, T2) as never, task, { result: "pass" }),
    ).rejects.toMatchObject(NOT_FOUND);
    const seen = await withHubScope(db, { kind: "user", userId: Z, tenantId: T2 }, (tx) =>
      tx.execute(sql`select task_id from hub.review_task_votes where task_id = ${task}::uuid`),
    );
    expect([...seen]).toHaveLength(0);
  });

  it("uỷ quyền: B' bỏ phiếu THAY A (phiếu user_id=A, on_behalf_of=D) + bằng chứng mỗi phiếu; A không bỏ lại được", async () => {
    await o`insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by)
      values (${T}, ${A}, ${D}, now() - interval '1 hour', now() + interval '1 day', '{approve}', ${A})`;
    try {
      const { task } = await startRun(GALL);
      expect(await card(D, task)).toMatchObject({ can_act: true, delegated_from: { id: A } });
      await decide(D, task, "pass", { evidence: { note: "Thay A: đồng ý" } });
      await decide(B, task, "pass", { evidence: { note: "B đồng ý" } });
      const vs = await votesOf(task);
      expect(vs.map((v) => [v.user_id, v.on_behalf_of])).toEqual([
        [A, D],
        [B, null],
      ]);
      expect(vs.every((v) => v.evidence_id !== null)).toBe(true);
      const ev = await o<{ by_user: string; on_behalf_of: string | null }[]>`
        select by_user::text, on_behalf_of::text from hub.evidence where subject_id = ${task} order by at`;
      expect(ev.map((e) => [e.by_user, e.on_behalf_of])).toEqual([
        [D, A],
        [B, null],
      ]);
      await expect(decide(A, task, "pass")).rejects.toMatchObject(CLOSED);
    } finally {
      await o`update hub.delegations set revoked_at = now() where from_user_id = ${A}`;
    }
  });

  it("quá hạn (đã chuyển cấp) khi đã có phiếu ⇒ người được chuyển quyết như bước thường, phiếu cũ giữ trong hồ sơ", async () => {
    const { runId, task } = await startRun(GALL);
    await decide(A, task, "pass");
    await o`insert into hub.review_task_assignees (tenant_id, task_id, user_id, group_id, via, depth)
      values (${T}, ${task}, ${X}, null, 'escalated', 1)`;
    expect(await card(X, task)).toMatchObject({ can_act: true });
    await decide(X, task, "pass");
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "approved" });
    const [t] = await o<{ status: string; decided_by: string }[]>`
      select status, decided_by::text from hub.review_tasks where id = ${task}`;
    expect(t).toEqual({ status: "closed", decided_by: X });
    expect((await votesOf(task)).map((v) => v.user_id)).toEqual([A]);
  });

  it("n = 0 (chỉ người gửi trong phòng) ⇒ giao 'Quá hạn chuyển cho' như việc một người; thẻ báo 0/0", async () => {
    const { runId, task } = await startRun(GSOLO, { after_h: 24, user_id: X });
    expect((await grantsOf(task)).map((x) => [x.user_id, x.via])).toEqual([[X, "escalated"]]);
    expect(await card(X, task)).toMatchObject({
      need: "all",
      votes: { done: 0, total: 0 },
      can_act: true,
    });
    // (bắt lỗi bằng `.catch` — `expect(p).rejects` ngay sau mở lượt từng treo chập chờn trên bun 1.3.14)
    expect(await decide(S, task, "pass").catch((e: unknown) => e)).toMatchObject(NOT_FOUND);
    await decide(X, task, "pass");
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "approved" });
    expect(await votesOf(task)).toHaveLength(0);
  });

  it("n = 0, không có 'Quá hạn chuyển cho' ⇒ quản trị công ty", async () => {
    const { task } = await startRun(GSOLO);
    expect((await grantsOf(task)).map((x) => [x.user_id, x.via])).toEqual([[M, "escalated"]]);
  });

  it("hai phiếu cuối CÙNG LÚC ⇒ cả hai ghi nhận, bước Đạt MỘT lần", async () => {
    const { runId, task } = await startRun(GALL);
    await decide(A, task, "pass");
    const out = await Promise.allSettled([decide(B, task, "pass"), decide(C, task, "pass")]);
    expect(out.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await stateOf(runId)).toMatchObject({ run: "done", decision: "approved" });
    expect(await votesOf(task)).toHaveLength(3);
    expect(applied.filter((x) => x === `${runId}:approved`)).toHaveLength(1);
  });
});
