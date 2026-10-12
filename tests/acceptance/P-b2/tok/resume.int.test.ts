// HUB-FR-136 (SHOULD) · AC-PB2-10 · plan D11/§4.2 · G-2 · G-7 · test-plan-cases §3.5 `tok/resume` (RZ-01…RZ-10, RR-11):
// resume CHỈ ở Hub — `use_session` trong payload + xoá `hub.cli_sessions` trước job "chạy mới"; resume (làm lại cùng stage,
// cùng agent, session ≤ 86 400 s) ⇒ prompt = `deltaPrompt`; tiếp sau trả lời (`continuing`) ⇒ prompt cũ. Runtime GIẢ: `cli_sessions`
// chèn bằng SQL (mô phỏng Runtime đã lưu session). DB tag `pb2_tok`. 0024 vắng ⇒ đỏ ở `needPb2`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { DEFS, jobAsk } from "../../P-a/pf1/_local";
import { answer } from "../../P-a/pf2/_local";
import {
  backToB3,
  type CtxPb2,
  DEFS2,
  finishStages,
  type Job,
  type Json,
  jobDone,
  jobOfStage,
  MD_HO,
  needPb2,
  P1,
  parToStep1,
  passStage,
  promptOf,
  review,
  settleRuns,
  startInRoom,
  startPb2,
  T,
  taskOf,
  waitFor,
  waitStage,
  waitStatus,
} from "../_support/pb2";

let c: CtxPb2;
beforeAll(async () => {
  c = await startPb2();
}, 60_000);
afterEach(async () => {
  if (c?.pb2) await settleRuns(c.sql);
});
afterAll(() => c?.stop());

const INPUT = "HD-12 tháng 9";
const DELTA = "Góp ý cần sửa:";
const convOf = async (runId: string): Promise<string> =>
  (await c.sql<Json[]>`select conversation_id from hub.process_runs where id = ${runId}`)[0]
    ?.conversation_id;
/** Mô phỏng Runtime đã lưu session của (hội thoại nền, agent) — `ageS` giây trước. */
async function putSession(runId: string, agentId: string, job: Job, ageS = 0): Promise<void> {
  const conv = await convOf(runId);
  await c.sql`insert into hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id, session_id, updated_at)
    values (${conv}, ${agentId}, ${job.payload.provider_key}, ${T.acme}, 'fake-sess-1',
      now() - make_interval(secs => ${ageS}))
    on conflict (conversation_id, agent_id, provider_key)
    do update set updated_at = excluded.updated_at, session_id = excluded.session_id`;
}
const sessions = async (runId: string, agentId: string): Promise<number> => {
  const conv = await convOf(runId);
  return (
    await c.sql<Json[]>`select count(*)::int as n from hub.cli_sessions
      where conversation_id = ${conv} and agent_id = ${agentId}`
  )[0]?.n;
};
const useSession = (j: Job) => (j.payload as Json).use_session;
/** pb2-par stage 0 (agPost) xong + session ⇒ B Chưa đạt `fb` ⇒ job làm lại. */
async function redoStage0(fb: string, ageS: number | null): Promise<{ runId: string; job: Job }> {
  const s = await startInRoom(c, { key: DEFS2.par.key });
  const j0 = await jobOfStage(c, s.runId, 0);
  if (ageS !== null) await putSession(s.runId, P1.agPost, j0, ageS);
  await jobDone(c, j0, MD_HO);
  await waitStage(c.sql, s.runId, 0, "waiting_review");
  const t = await taskOf(c.sql, s.runId, 0);
  expect((await review(c, "B", t?.id, { result: "fail", feedback: fb })).status).toBe(200);
  return { runId: s.runId, job: await jobOfStage(c, s.runId, 0) };
}
/** pb2-par stage 0 hỏi lại; session tuổi `ageS` (null = không có) ⇒ A trả lời ⇒ job tiếp. */
async function continueStage0(
  ageS: number | null,
): Promise<{ runId: string; job: Job; first: Job }> {
  const s = await startInRoom(c, { key: DEFS2.par.key });
  const j0 = await jobOfStage(c, s.runId, 0);
  if (ageS !== null) await putSession(s.runId, P1.agPost, j0, ageS);
  await jobAsk(c, j0, "Kỳ kế toán nào?", ["Tháng 9", "Tháng 10"]);
  await waitStage(c.sql, s.runId, 0, "waiting_answer");
  const ask = await taskOf(c.sql, s.runId, 0, "ask");
  expect((await answer(c, "A", ask?.id, { answer: "Tháng 9" })).status).toBe(200);
  return { runId: s.runId, job: await jobOfStage(c, s.runId, 0), first: j0 };
}

describe("RZ · làm lại cùng stage [AC-PB2-10][HUB-FR-136]", () => {
  it("AC-PB2-10 · RZ-01 · Phân tích Chưa đạt 'Thiếu MST', cùng agent, có session ⇒ use_session, prompt = delta (không HANDOFF/Đầu vào); session còn", async () => {
    needPb2(c.pb2);
    const { runId, job } = await redoStage0("Thiếu MST", 0);
    const p = promptOf(job);
    expect(useSession(job)).toBe(true);
    expect(p.startsWith(`${DELTA}\n`)).toBe(true);
    expect(p).toContain("Thiếu MST");
    expect(p).not.toContain("HANDOFF");
    expect(p).not.toContain("Đầu vào");
    expect(await sessions(runId, P1.agPost)).toBe(1);
  }, 60_000);
  it("AC-PB2-10 · RZ-02 · như RZ-01 nhưng không có session ⇒ prompt đầy đủ (có góp ý + đầu vào), use_session true", async () => {
    needPb2(c.pb2);
    const { job } = await redoStage0("Thiếu MST", null);
    const p = promptOf(job);
    expect(useSession(job)).toBe(true);
    expect(p.startsWith(DELTA)).toBe(false);
    expect(p).toContain("Thiếu MST");
    expect(p).toContain(INPUT);
  }, 60_000);
  it("AC-PB2-10 · RZ-03 · đổi agent stage giữa hai lần (snapshot agM1 → agM3) ⇒ không resume; cli_sessions (conv, agM3) bị DELETE", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    const j1 = await jobOfStage(c, runId, 1);
    await putSession(runId, P1.agM1, j1);
    await putSession(runId, P1.agM3, j1);
    await jobDone(c, j1, MD_HO);
    await waitStage(c.sql, runId, 1, "waiting_review");
    await c.sql`update hub.process_runs
      set snapshot = jsonb_set(snapshot, '{stages,1,executor,agent_id}', to_jsonb(${P1.agM3}::text)) where id = ${runId}`;
    const t = await taskOf(c.sql, runId, 1);
    expect((await review(c, "B", t?.id, { result: "fail", feedback: "Đổi agent" })).status).toBe(
      200,
    );
    const j = await jobOfStage(c, runId, 1);
    expect(j.payload.agent.id).toBe(P1.agM3);
    expect(promptOf(j).startsWith(DELTA)).toBe(false);
    expect(await sessions(runId, P1.agM3)).toBe(0);
  }, 60_000);
  it("AC-PB2-10 · RZ-09 · G-7 · session cũ 86 401 s ⇒ chạy mới (prompt đầy đủ, hàng bị xoá); 86 399 s ⇒ resume + delta", async () => {
    needPb2(c.pb2);
    const old = await redoStage0("Quá hạn", 86_401);
    expect(promptOf(old.job).startsWith(DELTA)).toBe(false);
    expect(promptOf(old.job)).toContain(INPUT);
    expect(await sessions(old.runId, P1.agPost)).toBe(0);
    await settleRuns(c.sql);
    const fresh = await redoStage0("Còn hạn", 86_399);
    expect(promptOf(fresh.job).startsWith(`${DELTA}\n`)).toBe(true);
    expect(await sessions(fresh.runId, P1.agPost)).toBe(1);
  }, 90_000);
  it("AC-PB2-10 · RZ-07 · quay lại bước 1 (round 2), cùng agent (agM1 riêng B1), session còn ⇒ B1 resume + delta chứa góp ý quay lại", async () => {
    needPb2(c.pb2);
    const g = await backToB3(c);
    const any = await c.sql<
      Json[]
    >`select payload from hub.jobs j join hub.runs r on r.id = j.run_id
      where r.process_run_id = ${g.runId} limit 1`;
    await putSession(g.runId, P1.agM1, { payload: any[0]?.payload } as Job);
    expect(
      (await review(c, "B", g.taskId, { result: "fail", feedback: "Sai số tổng", back_to_step: 1 }))
        .status,
    ).toBe(200);
    const j = await jobOfStage(c, g.runId, 1);
    expect(useSession(j)).toBe(true);
    expect(promptOf(j).startsWith(`${DELTA}\n`)).toBe(true);
    expect(promptOf(j)).toContain("Sai số tổng");
  }, 90_000);
});

describe("RZ · stage sau / cùng bước / nhóm [AC-PB2-10][G-2]", () => {
  it("AC-PB2-10 · RZ-04 · G-2 · pb2-seq-same: stage 1 lần đầu cùng agent agPost với stage 0 ⇒ chạy mới: session bị xoá, use_session true, prompt đầy đủ", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS2.seqSame.key });
    const j0 = await jobOfStage(c, s.runId, 0);
    await putSession(s.runId, P1.agPost, j0);
    await jobDone(c, j0, MD_HO);
    const j1 = await jobOfStage(c, s.runId, 1);
    expect(useSession(j1)).toBe(true);
    expect(promptOf(j1)).toContain(INPUT);
    expect(promptOf(j1).startsWith(DELTA)).toBe(false);
    expect(await sessions(s.runId, P1.agPost)).toBe(0);
  }, 60_000);
  it("AC-PB2-10 · RZ-05 · pb2-same bước 1 (S1a, S1b cùng agM1) ⇒ cả hai job use_session false; cli_sessions không bị xoá", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS2.same.key });
    const j0 = await jobOfStage(c, s.runId, 0);
    await jobDone(c, j0, MD_HO);
    await putSession(s.runId, P1.agM1, j0);
    await passStage(c, s.runId, 0, "B");
    const a = await jobOfStage(c, s.runId, 1);
    const b = await jobOfStage(c, s.runId, 2);
    expect([useSession(a), useSession(b)]).toEqual([false, false]);
    expect(await sessions(s.runId, P1.agM1)).toBe(1);
  }, 60_000);
  it("HUB-FR-114 · RZ-06 · stage team làm lại ⇒ use_session true, không xoá session, không delta (giữ cũ)", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS.team.key });
    const SEC: Record<string, string> = {
      [P1.agM1]: "Phần A",
      [P1.agM2]: "Phần B",
      [P1.agM3]: "Phần C",
    };
    let first: Job | undefined;
    for (let i = 0; i < 3; i++) {
      const row = await waitFor(
        async () =>
          (
            await c.sql<Json[]>`select j.run_id from hub.jobs j join hub.runs r on r.id = j.run_id
              where r.process_run_id = ${s.runId} and j.status = 'queued' order by j.created_at limit 1`
          )[0],
        (v) => v !== undefined,
        8_000,
      );
      const j = await c.rt.next(row?.run_id);
      first ??= j;
      await jobDone(c, j, `## ${SEC[j.payload.agent.id]}\nNội dung.`);
    }
    await waitStatus(c.sql, s.runId, "waiting_review");
    await putSession(s.runId, P1.agM1, first as Job);
    const t = await taskOf(c.sql, s.runId, 0);
    expect((await review(c, "B", t?.id, { result: "fail", feedback: "Sửa nhóm" })).status).toBe(
      200,
    );
    const row = await waitFor(
      async () =>
        (
          await c.sql<Json[]>`select j.run_id from hub.jobs j join hub.runs r on r.id = j.run_id
            where r.process_run_id = ${s.runId} and j.status = 'queued' order by j.created_at limit 1`
        )[0],
      (v) => v !== undefined,
      8_000,
    );
    const j = await c.rt.next(row?.run_id);
    expect(useSession(j)).toBe(true);
    expect(promptOf(j).startsWith(DELTA)).toBe(false);
    expect(await sessions(s.runId, P1.agM1)).toBe(1);
  }, 60_000);
});

describe("RZ · tiếp sau trả lời (continuing) [AC-PB2-10]", () => {
  it("AC-PB2-10 · RZ-08 · hỏi lại rồi trả lời, session còn ⇒ use_session true, prompt cũ (không 'Góp ý cần sửa:'), session còn", async () => {
    needPb2(c.pb2);
    const { runId, job } = await continueStage0(0);
    expect(useSession(job)).toBe(true);
    expect(promptOf(job).startsWith(DELTA)).toBe(false);
    expect(promptOf(job)).toContain(INPUT);
    expect(await sessions(runId, P1.agPost)).toBe(1);
  }, 60_000);
  it("AC-PB2-10 · RZ-10 · continuing + session hết hạn ⇒ prompt cũ + 'Câu hỏi trước:'/'Trả lời:', hàng bị xoá; pb2-same hỏi lại ⇒ có khối Câu hỏi/Trả lời", async () => {
    needPb2(c.pb2);
    const a = await continueStage0(86_401);
    const p = promptOf(a.job);
    expect(p.startsWith(DELTA)).toBe(false);
    for (const x of ["Câu hỏi trước:", "Kỳ kế toán nào?", "Trả lời:", "Tháng 9"])
      expect(p).toContain(x);
    expect(await sessions(a.runId, P1.agPost)).toBe(0);
    await settleRuns(c.sql);
    const s = await startInRoom(c, { key: DEFS2.same.key });
    await finishStages(c, s.runId, [0]);
    await passStage(c, s.runId, 0, "B");
    const j1 = await jobOfStage(c, s.runId, 1);
    await jobAsk(c, j1, "Phạm vi?", ["Hẹp", "Rộng"]);
    await waitStage(c.sql, s.runId, 1, "waiting_answer");
    const ask = await taskOf(c.sql, s.runId, 1, "ask");
    expect((await answer(c, "A", ask?.id, { answer: "Rộng" })).status).toBe(200);
    const j = await jobOfStage(c, s.runId, 1);
    expect(useSession(j)).toBe(false);
    for (const x of ["Câu hỏi trước:", "Phạm vi?", "Trả lời:", "Rộng"])
      expect(promptOf(j)).toContain(x);
  }, 90_000);
  it("AC-PB2-10 · RR-11 · ask trả lời TRƯỚC lần chạy mới nhất ⇒ continuing=false: Chưa đạt sau đó ⇒ resume + delta (không prompt cũ)", async () => {
    needPb2(c.pb2);
    const { runId, job } = await continueStage0(0);
    await jobDone(c, job, MD_HO);
    await waitStage(c.sql, runId, 0, "waiting_review");
    const t = await taskOf(c.sql, runId, 0);
    expect((await review(c, "B", t?.id, { result: "fail", feedback: "Sau trả lời" })).status).toBe(
      200,
    );
    const j = await jobOfStage(c, runId, 0);
    expect(promptOf(j).startsWith(`${DELTA}\n`)).toBe(true);
    expect(promptOf(j)).toContain("Sau trả lời");
  }, 60_000);
});
