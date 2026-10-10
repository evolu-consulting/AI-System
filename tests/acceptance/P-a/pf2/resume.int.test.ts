// HUB-FR-110 · HUB-BR-24 · ⇢PF1 (cả file): sau khi trả lời, launcher PF1 thật chạy tiếp stage — P2-04 phần job (job tiếp
// `user_id` = người bắt đầu A, không phải người trả lời H) + P2-11 (stage nhóm chạy tiếp tại `cursor`, không chạy lại thành
// viên đã xong). Chỉ xanh khi PF1 (launcher/team-runner) đã vào `main` (test-plan §1 cổng merge bước 3). Tách khỏi
// `ask.int`/`forward.int` vì cần hub KHÔNG có `stageLauncher` giả (`startPaReal`, `_local.ts`). Đỏ trước code ở `needSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  AGB,
  type CtxPa,
  defInput,
  insertDef,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  stageDef,
  T,
  waitFor,
} from "../_support/pa";
import { needSchema } from "../_support/schema";
import { answer, askRun, forward, seedDef, startPaReal } from "./_local";

const id = (n: number) => `a5a00000-0000-4000-8000-${String(20_000 + n).padStart(12, "0")}`;
const TEAM = id(1);
const M = [id(11), id(12), id(13)];
const DEF_TEAM = id(21);

let c: CtxPa;
async function processJobs(runId: string): Promise<Json[]> {
  return c.sql<
    Json[]
  >`select j.agent_id, r.user_id, r.team_run_id from hub.jobs j join hub.runs r on r.id = j.run_id
    where r.process_run_id = ${runId} order by j.queued_at, j.id`;
}
async function seedTeam(): Promise<void> {
  const [p] = await c.sql`select profile_id from hub.agents where id = ${AGB.hoadon}`;
  for (let i = 0; i < 3; i++)
    await c.sql`insert into hub.agents ${c.sql({
      id: M[i],
      key: `m${i + 1}`,
      name: c.sql.json({ vi: `Thành viên ${i + 1}`, en: `Member ${i + 1}` }),
      description: "Thành viên nhóm qc-team.",
      runtime: "agentic-cli",
      profile_id: p?.profile_id,
      system_prompt: "",
    })}`;
  await c.sql`insert into hub.agent_entitlements ${c.sql(M.map((agent_id) => ({ agent_id, tenant_id: T.acme })))}`;
  await c.sql`insert into hub.agent_teams (id, key, name, mode) values
    (${TEAM}, 'qc-team', ${c.sql.json({ vi: "Nhóm QC", en: "QC team" })}, 'sequential')`;
  const sec = ["Phần A", "Phần B", "Phần C"];
  for (let i = 0; i < 3; i++)
    await c.sql`insert into hub.agent_team_members (team_id, agent_id, role, sections, position)
      values (${TEAM}, ${M[i] as string}, ${`vai ${i + 1}`}, ${c.sql.array([sec[i] as string])}, ${i})`;
  await c.sql`insert into hub.agent_team_entitlements (team_id, tenant_id) values (${TEAM}, ${T.acme})`;
  const d = defInput({
    key: "p-team",
    stages: [
      stageDef({
        key: "nhom",
        name: "Nhóm viết",
        executor: { kind: "team", team_id: TEAM },
        output: {
          filename: "doc.md",
          template: "## Phần A\n\n## Phần B\n\n## Phần C\n",
          required_sections: sec,
          fields: [],
        },
        after: { kind: "auto" },
      }),
    ],
  });
  await insertDef(c.sql, { id: DEF_TEAM, tenantId: T.acme, input: d });
}

beforeAll(async () => {
  c = await startPaReal();
  if (!c.ready) return;
  await seedDef(c);
  await seedTeam();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("⇢PF1 · chạy tiếp sau trả lời [HUB-BR-24, HUB-FR-110]", () => {
  it("HUB-BR-24 · P2-04 ⇢PF1 · H (được nhờ) trả lời ⇒ job stage tiếp theo có user_id = A (người bắt đầu), không phải H", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    expect((await forward(c, "A", f.taskId, PA.H.id)).status).toBe(200);
    expect((await answer(c, "H", f.taskId, { answer: "dd/mm" })).status).toBe(200);
    const jobs = await waitFor(
      () => processJobs(f.run.runId),
      (j) => j.length > 0,
      10_000,
    );
    expect(jobs.length).toBeGreaterThan(0);
    expect(new Set(jobs.map((j) => j.user_id))).toEqual(new Set([PA.A.id]));
  });
  it("HUB-FR-110 · P2-11 ⇢PF1 · stage nhóm hỏi ở thành viên 2 (cursor 1): A trả lời ⇒ chạy tiếp m2, không chạy lại m1", async () => {
    needSchema(c.ready);
    const d = defInput({ key: "p-team" });
    const run = await insertRun(c.sql, {
      def: { id: DEF_TEAM, key: "p-team", name: d.name as string, stages: [] as Json[] },
      startedBy: PA.A,
      roomId: PA_FIX.room,
      status: "waiting_answer",
    });
    const [def] = await c.sql`select stages from hub.process_defs where id = ${DEF_TEAM}`;
    await c.sql`update hub.process_runs set snapshot = jsonb_set(snapshot, '{stages}', ${c.sql.json(def?.stages)})
      where id = ${run.runId}`;
    await c.sql`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status, asks_count)
      values (${T.acme}, ${run.runId}, 0, 'waiting_answer', 1)`;
    const [sr] =
      await c.sql`select id from hub.stage_runs where process_run_id = ${run.runId} and stage_idx = 0`;
    const [tr] =
      await c.sql`insert into hub.team_runs (tenant_id, stage_run_id, process_run_id, attempt, team_id, mode, cursor,
        status, calls) values (${T.acme}, ${sr?.id}, ${run.runId}, 1, ${TEAM}, 'sequential', 1, 'waiting_answer', 2)
      returning id`;
    const taskId = await insertTask(c.sql, {
      tid: T.acme,
      runId: run.runId,
      stageRunId: sr?.id,
      kind: "ask",
      question: "[vai 2] Phần B cần số liệu quý nào?",
      userIds: [PA.A.id],
    });
    expect((await answer(c, "A", taskId, { answer: "Quý 3" })).status).toBe(200);
    const jobs = await waitFor(
      () => processJobs(run.runId),
      (j) => j.length > 0,
      10_000,
    );
    expect(jobs[0]?.agent_id).toBe(M[1]);
    expect(jobs.map((j) => j.agent_id)).not.toContain(M[0]);
    expect(jobs[0]?.team_run_id).toBe(tr?.id);
    expect(jobs[0]?.user_id).toBe(PA.A.id);
  });
});
