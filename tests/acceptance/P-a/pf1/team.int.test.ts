// HUB-FR-114 · HUB-FR-115 · HUB-BR-23 (ngoại lệ C2) · AC-H32 · P1-30…P1-36 (test-plan-int §2; plan D7, D8, §2.1; spec C2):
// stage nhóm — sequential (`qc-team`), lead_plan (`lead-team`), giới hạn nhóm (calls/tokens/time/no_change), làm lại theo mục,
// `active_ms` không tính thời gian chờ trả lời, C2 (grant thành viên không kiểm; entitlement nhóm + agent bật vẫn kiểm).
// Runtime giả trả mục theo `job.payload.agent.id`. Trước code: đỏ ở `needSchema`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { type Json, PA, type Sql, waitFor } from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  DEFS,
  type Job,
  jobAsk,
  jobDone,
  nextStageJob,
  noStageJob,
  openTask,
  outputs,
  P1,
  review,
  runRow,
  stageHubRuns,
  startInRoom,
  startPf1,
  TEAM_TEMPLATE,
  waitStatus,
} from "./_local";

let c: CtxPf1;
beforeAll(async () => {
  c = await startPf1();
}, 60_000);
afterEach(async () => {
  if (c?.ready) await settleAll(c.sql);
});
afterAll(async () => {
  await c?.stop();
});

async function settleAll(sql: Sql): Promise<void> {
  await sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;
  await sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
  await sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where status = 'running'`;
}

const SEC: Record<string, string> = {
  [P1.agM1]: "Phần A",
  [P1.agM2]: "Phần B",
  [P1.agM3]: "Phần C",
};
const KEY: Record<string, string> = {
  [P1.agM1]: "m1",
  [P1.agM2]: "m2",
  [P1.agM3]: "m3",
  [P1.agLead]: "lead1",
};
/** Thành viên trả đúng mục mình (nội dung có dấu `tag`). */
const ownMd = (job: Job, tag = "v1") =>
  `## ${SEC[job.payload.agent.id]}\nNội dung ${KEY[job.payload.agent.id]} ${tag}.`;

/** Phục vụ mọi job của process run tới khi run rời `running` hoặc hết `ms`; trả các job đã nhận theo thứ tự. */
async function serveProc(
  runId: string,
  handler: (j: Job, i: number) => Promise<void>,
  ms = 15_000,
): Promise<Job[]> {
  const end = Date.now() + ms;
  const jobs: Job[] = [];
  while (Date.now() < end) {
    if ((await runRow(c.sql, runId))?.status !== "running") break;
    const q = await waitFor(
      async () =>
        (
          await c.sql<
            { run_id: string }[]
          >`select j.run_id from hub.jobs j join hub.runs r on r.id = j.run_id
            where r.process_run_id = ${runId} and j.status = 'queued' order by j.created_at limit 1`
        )[0],
      (v) => v !== undefined,
      300,
    );
    if (!q) continue;
    const j = await c.rt.tryNext(q.run_id, 300);
    if (!j) continue;
    jobs.push(j);
    await handler(j, jobs.length - 1);
  }
  return jobs;
}
const teamRuns = (runId: string) =>
  c.sql<
    Json[]
  >`select * from hub.team_runs where process_run_id = ${runId} order by attempt, started_at`;
const decisionOf = async (runId: string): Promise<Json> => (await runRow(c.sql, runId))?.decision;

/** `p-team` tới gate (3 thành viên trả mục mình). */
async function teamToGate(): Promise<{ runId: string; taskId: string; jobs: Job[] }> {
  const s = await startInRoom(c, { key: DEFS.team.key });
  const jobs = await serveProc(s.runId, (j) => jobDone(c, j, ownMd(j)));
  await waitStatus(c.sql, s.runId, "waiting_review");
  const t = await openTask(c.sql, s.runId, "review");
  return { runId: s.runId, taskId: t?.id, jobs };
}
/** B Chưa đạt rồi gom agent của các job làm lại tới khi run về gate. */
async function redoAgents(runId: string, taskId: string, body: Json): Promise<string[]> {
  expect((await review(c, "B", taskId, { result: "fail", ...body })).status).toBe(200);
  const jobs = await serveProc(runId, (j) => jobDone(c, j, ownMd(j, "v2")));
  await waitStatus(c.sql, runId, "waiting_review");
  return jobs.map((j) => j.payload.agent.id);
}

describe("P1-30…P1-36 · stage nhóm [HUB-FR-114]", () => {
  it("HUB-FR-114 · P1-30 · qc-team 3 thành viên: 3 job riêng (team_run_id), job k nhận file chung version k, mục không sở hữu bị bỏ, output đủ 3 mục", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c, { key: DEFS.team.key });
    const jobs = await serveProc(s.runId, async (j, i) => {
      const extra = i === 0 ? "\n\n## Phần B\nFOREIGN-B của m1." : "";
      await jobDone(c, j, ownMd(j) + extra);
    });
    await waitStatus(c.sql, s.runId, "waiting_review");
    expect(jobs.map((j) => j.payload.agent.id)).toEqual([P1.agM1, P1.agM2, P1.agM3]);
    const hubRuns = await stageHubRuns(c.sql, s.runId);
    const [tr] = await teamRuns(s.runId);
    expect(tr?.team_id).toBe(P1.teamQc);
    for (const r of hubRuns) expect(r.team_run_id).toBe(tr?.id);
    for (const [k, j] of jobs.entries()) {
      const names = ((j.payload.attachments ?? []) as Json[]).map((a) => String(a.name));
      // Edge #135: stage nhóm đầu ở stage 0 chưa có job ⇒ member đầu không nhận nháp v1 (khởi tạo từ prompt);
      // member k≥1 nhận nháp version k của member trước.
      if (k === 0) expect(names).toEqual([]);
      else expect(names.some((n) => n.includes(`-v${k + 1}-`))).toBe(true);
    }
    const out = (await outputs(c.sql, s.runId)).at(-1);
    expect(out?.template_ok).toBe(true);
    expect(out?.content).toContain("Nội dung m1 v1");
    expect(out?.content).toContain("Nội dung m2 v1");
    expect(out?.content).toContain("Nội dung m3 v1");
    expect(out?.content).not.toContain("FOREIGN-B");
  }, 40_000);

  describe("P1-31 · D7 lead_plan", () => {
    it("HUB-FR-114 · P1-31 · lead-team kế hoạch JSON 2 bước ⇒ 1 job plan + 2 job member", async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { key: DEFS.lead.key });
      // cùng dạng R-T01 (`parseLeadPlan`): mảng bước JSON
      const plan = [
        { member: "m1", sections: ["Phần A"], instruction: "Viết phần A" },
        { member: "m3", sections: ["Phần C"], instruction: "Viết phần C" },
      ];
      const jobs = await serveProc(s.runId, (j) =>
        j.payload.agent.id === P1.agLead
          ? jobDone(c, j, JSON.stringify(plan))
          : jobDone(c, j, ownMd(j)),
      );
      expect(jobs.map((j) => j.payload.agent.id)).toEqual([P1.agLead, P1.agM1, P1.agM3]);
      const [tr] = await teamRuns(s.runId);
      expect(tr?.mode).toBe("lead_plan");
      expect(tr?.plan).toBeTruthy();
    }, 40_000);

    it("HUB-FR-114 · P1-31 · kế hoạch hỏng ⇒ plan_fallback chạy tuần tự m1, m2, m3", async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { key: DEFS.lead.key });
      const jobs = await serveProc(s.runId, (j) =>
        j.payload.agent.id === P1.agLead ? jobDone(c, j, "xin chào") : jobDone(c, j, ownMd(j)),
      );
      expect(jobs.map((j) => j.payload.agent.id)).toEqual([P1.agLead, P1.agM1, P1.agM2, P1.agM3]);
      const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.run_steps s
        join hub.runs r on r.id = s.run_id where r.process_run_id = ${s.runId} and to_jsonb(s)::text like '%plan_fallback%'`;
      expect(n?.n).toBeGreaterThanOrEqual(1);
    }, 40_000);
  });

  describe("P1-32 · AC-H32 giới hạn nhóm (options 3)", () => {
    async function limitCase(
      prep: (trId: string) => Promise<void>,
      md: (j: Job) => string,
      tok?: { input: number; output: number },
    ) {
      const s = await startInRoom(c, { key: DEFS.team.key });
      const j1 = await nextStageJob(c, s.runId);
      const [tr] = await teamRuns(s.runId);
      expect(tr).toBeDefined();
      await prep(tr?.id);
      await jobDone(c, j1, md(j1), tok);
      return s.runId;
    }
    it("AC-H32 · P1-32 · calls: team_runs.calls=10 (SQL) ⇒ lần gọi 11 không phát, stop_reason=calls, needs_decision team_calls", async () => {
      needSchema(c.ready);
      const runId = await limitCase(
        async (id) => {
          await c.sql`update hub.team_runs set calls = 10 where id = ${id}`;
        },
        (j) => ownMd(j),
      );
      await waitStatus(c.sql, runId, "needs_decision");
      expect(await noStageJob(c, runId)).toBe(true);
      expect((await teamRuns(runId))[0]?.stop_reason).toBe("calls");
      const d = await decisionOf(runId);
      expect(d?.reason).toBe("team_calls");
      expect(d?.options).toHaveLength(3);
    }, 30_000);

    it("AC-H32 · P1-32 · tokens: usage 30k/lần, đã 180k (SQL) ⇒ needs_decision team_tokens", async () => {
      needSchema(c.ready);
      const runId = await limitCase(
        async (id) => {
          await c.sql`update hub.team_runs set tokens = 180000 where id = ${id}`;
        },
        (j) => ownMd(j),
        { input: 25_000, output: 5_000 },
      );
      await waitStatus(c.sql, runId, "needs_decision");
      expect((await teamRuns(runId))[0]?.stop_reason).toBe("tokens");
      const d = await decisionOf(runId);
      expect(d?.reason).toBe("team_tokens");
      expect(d?.options).toHaveLength(3);
    }, 30_000);

    it("AC-H32 · P1-32 · time: active_ms 600 000 (SQL) ⇒ needs_decision team_time", async () => {
      needSchema(c.ready);
      const runId = await limitCase(
        async (id) => {
          await c.sql`update hub.team_runs set active_ms = 600000 where id = ${id}`;
        },
        (j) => ownMd(j),
      );
      await waitStatus(c.sql, runId, "needs_decision");
      expect((await teamRuns(runId))[0]?.stop_reason).toBe("time");
      const d = await decisionOf(runId);
      expect(d?.reason).toBe("team_time");
      expect(d?.options).toHaveLength(3);
    }, 30_000);

    it("AC-H32 · P1-32 · no_change: 2 lần trả y hệt (không đổi file) ⇒ needs_decision team_no_change", async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { key: DEFS.team.key });
      await serveProc(s.runId, (j) => jobDone(c, j, TEAM_TEMPLATE));
      await waitStatus(c.sql, s.runId, "needs_decision");
      expect((await teamRuns(s.runId))[0]?.stop_reason).toBe("no_change");
      const d = await decisionOf(s.runId);
      expect(d?.reason).toBe("team_no_change");
      expect(d?.options).toHaveLength(3);
    }, 30_000);
  });

  it("HUB-FR-114 · P1-33 · Chưa đạt sau P1-30 ⇒ team_runs mới attempt 2, bộ đếm calls làm lại từ 0", async () => {
    needSchema(c.ready);
    const g = await teamToGate();
    const [tr1] = await teamRuns(g.runId);
    expect(tr1?.calls).toBe(3);
    expect(
      (await review(c, "B", g.taskId, { result: "fail", feedback: "Sửa lại cả tài liệu" })).status,
    ).toBe(200);
    const tr2 = await waitFor(
      async () => (await teamRuns(g.runId)).find((t) => t.attempt === 2),
      (v) => v !== undefined,
      5_000,
    );
    expect(tr2?.attempt).toBe(2);
    expect(tr2?.id).not.toBe(tr1?.id);
    // `calls=0` lúc tạo; Hub có thể đã phát lần gọi đầu ngay sau ⇒ ≤ 1 (không mang 3 lần của attempt 1).
    expect(tr2?.calls).toBeLessThanOrEqual(1);
  }, 40_000);

  describe("P1-34 · D8 làm lại theo mục", () => {
    it('HUB-FR-114 · P1-34 · Chưa đạt `sections:["Phần B"]` ⇒ chỉ job m2', async () => {
      needSchema(c.ready);
      const g = await teamToGate();
      expect(
        await redoAgents(g.runId, g.taskId, { feedback: "Phần B thiếu", sections: ["Phần B"] }),
      ).toEqual([P1.agM2]);
    }, 40_000);
    it('HUB-FR-114 · P1-34 · góp ý nhắc "phần c" (vắng sections) ⇒ chỉ job m3', async () => {
      needSchema(c.ready);
      const g = await teamToGate();
      expect(await redoAgents(g.runId, g.taskId, { feedback: "Cần sửa phần c cho rõ" })).toEqual([
        P1.agM3,
      ]);
    }, 40_000);
    it("HUB-FR-114 · P1-34 · góp ý không khớp mục ⇒ cả nhóm m1, m2, m3", async () => {
      needSchema(c.ready);
      const g = await teamToGate();
      expect(await redoAgents(g.runId, g.taskId, { feedback: "Chưa ổn tổng thể" })).toEqual([
        P1.agM1,
        P1.agM2,
        P1.agM3,
      ]);
    }, 40_000);
  });

  it("AC-H32 · P1-35 · nhóm need_input lúc active_ms=300 000, chờ 20 phút (SQL lùi segment_started_at) rồi trả lời ⇒ active_ms không tính thời gian chờ", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c, { key: DEFS.team.key });
    const j1 = await nextStageJob(c, s.runId);
    const [tr] = await teamRuns(s.runId);
    await c.sql`update hub.team_runs set active_ms = 300000 where id = ${tr?.id}`;
    await jobAsk(c, j1, "Phạm vi tài liệu?", ["Toàn bộ", "Phần A"]);
    await waitStatus(c.sql, s.runId, "waiting_answer");
    expect((await teamRuns(s.runId))[0]?.status).toBe("waiting_answer");
    await c.sql`update hub.team_runs set segment_started_at = segment_started_at - interval '20 minutes'
      where id = ${tr?.id} and segment_started_at is not null`;
    const ask = await openTask(c.sql, s.runId, "ask");
    expect(
      (await c.call("A", "POST", `/review-tasks/${ask?.id}/answer`, { answer: "Toàn bộ" })).status,
    ).toBe(200);
    const j2 = await nextStageJob(c, s.runId);
    await jobDone(c, j2, ownMd(j2));
    const after = (await teamRuns(s.runId))[0];
    expect(after?.active_ms).toBeGreaterThanOrEqual(300000);
    expect(after?.active_ms).toBeLessThan(300000 + 20 * 60_000);
    expect(after?.active_ms).toBeLessThan(360000);
  }, 40_000);

  describe("P1-36 · C2 ngoại lệ HUB-BR-23", () => {
    it("HUB-BR-23 · P1-36 · (a) A không grant m1–m3, qc-team bật cho acme ⇒ stage chạy, 3 job (user_id=A), output ghép", async () => {
      needSchema(c.ready);
      const [g] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.agent_grants
        where subject_id = ${PA.A.id} and agent_id in (${P1.agM1}, ${P1.agM2}, ${P1.agM3})`;
      expect(g?.n).toBe(0);
      const s = await startInRoom(c, { key: DEFS.team.key });
      const jobs = await serveProc(s.runId, (j) => jobDone(c, j, ownMd(j)));
      await waitStatus(c.sql, s.runId, "waiting_review");
      expect(jobs).toHaveLength(3);
      for (const j of jobs) expect(j.payload.user_id).toBe(PA.A.id);
      expect((await outputs(c.sql, s.runId)).at(-1)?.template_ok).toBe(true);
    }, 40_000);

    it("HUB-BR-23 · P1-36 · (b) thu entitlement qc-team của acme trước kick ⇒ 0 job, needs_decision permission_lost, options 3", async () => {
      needSchema(c.ready);
      await c.sql`update hub.agent_team_entitlements set revoked_at = now() where team_id = ${P1.teamQc}`;
      try {
        const s = await startInRoom(c, { key: DEFS.team.key });
        await waitStatus(c.sql, s.runId, "needs_decision");
        expect(await noStageJob(c, s.runId)).toBe(true);
        const d = await decisionOf(s.runId);
        expect(d?.reason).toBe("permission_lost");
        expect(d?.options).toHaveLength(3);
      } finally {
        await c.sql`update hub.agent_team_entitlements set revoked_at = null where team_id = ${P1.teamQc}`;
      }
    }, 30_000);

    it("HUB-BR-23 · P1-36 · (c) tắt agent m2 trước kick ⇒ như (b): 0 job thành viên, permission_lost (không chạy thành viên còn lại)", async () => {
      needSchema(c.ready);
      await c.sql`update hub.agents set enabled = false where id = ${P1.agM2}`;
      await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
      try {
        const s = await startInRoom(c, { key: DEFS.team.key });
        await waitStatus(c.sql, s.runId, "needs_decision");
        expect(await noStageJob(c, s.runId)).toBe(true);
        const d = await decisionOf(s.runId);
        expect(d?.reason).toBe("permission_lost");
        expect(d?.options).toHaveLength(3);
        const trs = await teamRuns(s.runId);
        expect(trs.length === 0 || trs[0]?.stop_reason !== null).toBe(true);
      } finally {
        await c.sql`update hub.agents set enabled = true where id = ${P1.agM2}`;
        await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
      }
    }, 30_000);

    it("HUB-BR-23 · P1-36 · (d) stage agent đơn hd-read, A không grant ⇒ needs_decision permission_lost (grant vẫn kiểm)", async () => {
      needSchema(c.ready);
      await c.sql`delete from hub.agent_grants where agent_id = ${P1.agRead} and subject_id = ${PA.A.id}`;
      await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
      try {
        const s = await startInRoom(c, { key: DEFS.single.key });
        await waitStatus(c.sql, s.runId, "needs_decision");
        expect((await decisionOf(s.runId))?.reason).toBe("permission_lost");
        expect((await stageHubRuns(c.sql, s.runId)).length).toBe(0);
      } finally {
        await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
          values (${P1.agRead}, ${PA.A.tid}, 'user', ${PA.A.id})`;
        await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
      }
    }, 30_000);
  });
});
