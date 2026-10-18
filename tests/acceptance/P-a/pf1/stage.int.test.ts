// HUB-FR-106 · HUB-FR-115 · HUB-FR-116 · HUB-BR-23 · HUB-BR-26 · HUB-BR-27 · AC-H28 · AC-H33 · P1-20…P1-29 (test-plan-int §2):
// stage chạy qua runtime giả (claim `hub.jobs`), output có phiên bản + kiểm template (M3), ngữ cảnh stage kế (D6), snapshot
// (BR-27), mất quyền giữa run (BR-23), timeout / lỗi / ngân sách token (C1), quét `interrupted` (D11) + `queued` mồ côi (K4).
// Trước code: mọi ca đỏ ở `needSchema` (0019 vắng) — beforeAll không chèn bảng mới khi `ready=false`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { insertRun, type Json, PA, PA_FIX, type Sql, stageDef, waitFor } from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  DEFS,
  insertDefPf1,
  jobDone,
  MD_AUTO,
  MD_MISSING,
  MD_OK,
  nextStageJob,
  noStageJob,
  openTask,
  outputs,
  P1,
  review,
  runRow,
  stageHubRuns,
  stageRow,
  startInRoom,
  startPf1,
  sweep,
  toGate,
  waitStatus,
} from "./_local";

const x = (n: number) => `a5a10000-0000-4000-8000-${String(200 + n).padStart(12, "0")}`;
const DEF_TIMEOUT = { id: x(1), key: "p-timeout", name: "Timeout thử" };
const DEF_BUDGET_S = { id: x(2), key: "p-budget-s", name: "Ngân sách stage" };
const DEF_BUDGET_R = { id: x(3), key: "p-budget-r", name: "Ngân sách run" };
const autoStage = (key: string, o: Json = {}) =>
  stageDef({
    key,
    executor: { kind: "agent", agent_id: P1.agRead },
    after: { kind: "auto" },
    ...o,
  });

let c: CtxPf1;
beforeAll(async () => {
  c = await startPf1();
  if (!c.ready) return;
  await insertDefPf1(c.sql, { ...DEF_TIMEOUT, stages: [autoStage("t1", { timeout_s: 60 })] });
  await insertDefPf1(c.sql, {
    ...DEF_BUDGET_S,
    stages: [autoStage("b1", { token_budget: 1000 }), autoStage("b2")],
  });
  await insertDefPf1(
    c.sql,
    { ...DEF_BUDGET_R, stages: [autoStage("r1"), autoStage("r2"), autoStage("r3")] },
    {
      tokenBudget: 2000,
    },
  );
}, 60_000);
afterEach(async () => {
  if (c?.ready) await settleAll(c.sql);
});
afterAll(async () => {
  await c?.stop();
});

/** Dọn run còn hoạt động giữa ca (giới hạn 5 run/tenant, 4 run Hub đồng thời). */
async function settleAll(sql: Sql): Promise<void> {
  await sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;
  await sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
  await sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where status = 'running'`;
}
const decisionOf = async (runId: string): Promise<Json> => (await runRow(c.sql, runId))?.decision;

describe("P1-20…P1-29 · stage [HUB-FR-106]", () => {
  it("AC-H28 · P1-20 · runtime trả md đủ mục ⇒ output v1 template_ok, attachment output của A, task review group Kế toán, waiting_review", async () => {
    needSchema(c.ready);
    const g = await toGate(c);
    const outs = await outputs(c.sql, g.runId);
    expect(outs.length).toBe(1);
    expect(outs[0]).toMatchObject({ version: 1, attempt: 1, template_ok: true, stage_idx: 0 });
    expect(outs[0].template_missing ?? []).toEqual([]);
    expect(outs[0].attachment_id).toBeTruthy();
    const [att] = await c.sql<
      Json[]
    >`select user_id, origin from hub.attachments where id = ${outs[0].attachment_id}`;
    expect(att).toMatchObject({ user_id: PA.A.id, origin: "output" });
    const t = await openTask(c.sql, g.runId, "review");
    expect(t?.output_id).toBe(outs[0].id);
    const asg = await c.sql<
      Json[]
    >`select user_id, group_id from hub.review_task_assignees where task_id = ${t?.id}`;
    expect([...asg]).toEqual([{ user_id: null, group_id: PA_FIX.gKeToan }]);
    expect((await runRow(c.sql, g.runId)).status).toBe("waiting_review");
    expect((await stageRow(c.sql, g.runId, 0)).status).toBe("waiting_review");
  }, 30_000);

  it("HUB-FR-106 · P1-21 · M3: thiếu `## Tổng tiền` ⇒ v1 template_ok=false; attempt 2 tự chạy, prompt có lỗi kiểm; hết lượt ⇒ template_invalid", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c);
    const j1 = await nextStageJob(c, s.runId);
    await jobDone(c, j1, MD_MISSING);
    const j2 = await nextStageJob(c, s.runId);
    const [v1] = await outputs(c.sql, s.runId);
    expect(v1).toMatchObject({ version: 1, template_ok: false });
    expect(v1?.template_missing).toEqual(["Tổng tiền"]);
    expect((await stageRow(c.sql, s.runId, 0)).attempt).toBe(2);
    expect(j2.payload.prompt).toContain("Tổng tiền");
    await jobDone(c, j2, MD_MISSING);
    for (let i = 3; i <= 4; i++) await jobDone(c, await nextStageJob(c, s.runId), MD_MISSING);
    await waitStatus(c.sql, s.runId, "needs_decision");
    expect((await decisionOf(s.runId))?.reason).toBe("template_invalid");
    expect(await noStageJob(c, s.runId)).toBe(true);
  }, 60_000);

  it("HUB-FR-106 · P1-22 · D6: làm lại có góp ý trong prompt; stage 2 nhận file output đã chốt của stage 1", async () => {
    needSchema(c.ready);
    const g = await toGate(c);
    expect((await review(c, "B", g.taskId, { result: "fail", feedback: "Thiếu MST" })).status).toBe(
      200,
    );
    const j2 = await nextStageJob(c, g.runId);
    expect(j2.payload.prompt).toContain("Thiếu MST");
    await jobDone(c, j2, MD_OK);
    await waitStatus(c.sql, g.runId, "waiting_review");
    const t2 = await openTask(c.sql, g.runId, "review");
    expect((await review(c, "B", t2?.id, { result: "pass" })).status).toBe(200);
    const j3 = await nextStageJob(c, g.runId);
    expect(j3.payload.agent.id).toBe(P1.agPost);
    const v2 = (await outputs(c.sql, g.runId)).find((o) => o.stage_idx === 0 && o.version === 2);
    expect(v2?.attachment_id).toBeTruthy();
    const atts = (j3.payload.attachments ?? []) as Json[];
    expect(atts.some((a) => a.id === v2?.attachment_id && a.name === "s0-v2-hoa-don.md")).toBe(
      true,
    );
  }, 60_000);

  it("HUB-BR-27 · P1-23 · AC-H33: sửa def khi run ở gate ⇒ stage 2 chạy agent cũ (snapshot); run mới dùng bản mới; DELETE def ⇒ run đang chạy vẫn chạy", async () => {
    needSchema(c.ready);
    const g = await toGate(c);
    const cur = await c.call("Adm", "GET", `/process-defs/${PA_FIX.defHoaDon}`);
    expect(cur.status).toBe(200);
    const d = cur.json as Json;
    const stages = (d.stages as Json[]).map((s, i) =>
      i === 1 ? { ...s, executor: { kind: "agent", agent_id: P1.agM1 } } : s,
    );
    const body = {
      key: d.key,
      name: "Hoá đơn thử (sửa)",
      description: d.description,
      input_hint: d.input_hint,
      run_group_ids: d.run_group_ids,
      stages,
      token_budget: d.token_budget,
      enabled: d.enabled,
      version: d.version,
    };
    const put = await c.call("Adm", "PUT", `/process-defs/${PA_FIX.defHoaDon}`, body);
    expect(put.status).toBe(200);
    expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
    const j = await nextStageJob(c, g.runId);
    expect(j.payload.agent.id).toBe(P1.agPost);
    const r1 = await runRow(c.sql, g.runId);
    expect(r1.snapshot.name).toBe("Hoá đơn thử");
    const s2 = await startInRoom(c, { input: "HD-13" });
    const r2 = await runRow(c.sql, s2.runId);
    expect(r2.snapshot.stages[1].executor.agent_id).toBe(P1.agM1);
    expect(r2.snapshot.name).toBe("Hoá đơn thử (sửa)");
    try {
      const del = await c.call(
        "Adm",
        "DELETE",
        `/process-defs/${PA_FIX.defHoaDon}?version=${put.json?.version}`,
      );
      expect(del.status).toBe(204);
      await jobDone(c, j, "## Kết quả\nĐã ghi sổ.");
      await waitStatus(c.sql, g.runId, "done");
    } finally {
      // Ca này sửa + xoá def dùng chung `hoa-don-t`: khôi phục nguyên trạng seed để P1-24… không phụ thuộc thứ tự.
      await c.sql`update hub.process_defs set deleted_at = null, name = ${DEFS.hd.name},
        stages = ${c.sql.json(DEFS.hd.stages as Json[])}, enabled = true, version = 1
        where id = ${PA_FIX.defHoaDon}`;
    }
  }, 60_000);

  describe("P1-24 · BR-23 mất quyền ở gate", () => {
    it("HUB-BR-23 · P1-24 · AC-H33: thu hồi grant A cho hd-post ⇒ B Đạt ⇒ 0 hub.runs stage 2, needs_decision permission_lost, options 3", async () => {
      needSchema(c.ready);
      const g = await toGate(c);
      const before = (await stageHubRuns(c.sql, g.runId)).length;
      await c.sql`delete from hub.agent_grants where agent_id = ${P1.agPost} and subject_id = ${PA.A.id}`;
      await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
      try {
        expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
        await waitStatus(c.sql, g.runId, "needs_decision");
        const dec = await decisionOf(g.runId);
        expect(dec?.reason).toBe("permission_lost");
        expect(dec?.options).toHaveLength(3);
        expect((await stageHubRuns(c.sql, g.runId)).length).toBe(before);
      } finally {
        await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
          values (${P1.agPost}, ${PA.A.tid}, 'user', ${PA.A.id})`;
        await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
      }
    }, 40_000);

    it("HUB-BR-23 · P1-24 · AC-H33: khoá A ở gate ⇒ B Đạt ⇒ 0 hub.runs stage 2, needs_decision user_inactive, options 3", async () => {
      needSchema(c.ready);
      const g = await toGate(c);
      const before = (await stageHubRuns(c.sql, g.runId)).length;
      await c.sql`update admin.users set locked_by_tenant = true where id = ${PA.A.id}`;
      try {
        expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
        await waitStatus(c.sql, g.runId, "needs_decision");
        const dec = await decisionOf(g.runId);
        expect(dec?.reason).toBe("user_inactive");
        expect(dec?.options).toHaveLength(3);
        expect((await stageHubRuns(c.sql, g.runId)).length).toBe(before);
      } finally {
        await c.sql`update admin.users set locked_by_tenant = false where id = ${PA.A.id}`;
      }
    }, 40_000);
  });

  /** D4/CR-083: lỗi tạm ⇒ stage `waiting_timer` (retry 1), run vẫn `running`, 0 decision. */
  const expectRetrying = async (runId: string, code: string) => {
    const row = await waitFor(
      () => c.sql<Json[]>`select status, retry_count, last_error_code from hub.stage_runs
        where process_run_id = ${runId} and stage_idx = 0`,
      (v) => v?.[0]?.status === "waiting_timer",
      8_000,
    );
    expect(row?.[0]).toMatchObject({
      status: "waiting_timer",
      retry_count: 1,
      last_error_code: code,
    });
    expect((await c.sql`select status from hub.process_runs where id = ${runId}`)[0]?.status).toBe(
      "running",
    );
    expect(await decisionOf(runId)).toBeFalsy();
  };

  it("HUB-FR-115 · P1-25 · §2.1: timeout_s=60, runtime failed{TIMEOUT} ⇒ stage waiting_timer (retry 1, TIMEOUT), 0 decision", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c, { key: DEF_TIMEOUT.key });
    const j = await nextStageJob(c, s.runId);
    expect(j.payload.timeout_s).toBe(60);
    await c.rt.fail(j, "TIMEOUT", "quá thời gian", null, "timed_out");
    await expectRetrying(s.runId, "TIMEOUT");
  }, 30_000);

  it("HUB-BR-26 · P1-26 · runtime failed ⇒ needs_decision agent_failed; không chạy stage kế", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c, { key: DEFS.auto.key });
    const j = await nextStageJob(c, s.runId);
    await c.rt.fail(j, "UPSTREAM_ERROR", "agent lỗi", "refused");
    await waitStatus(c.sql, s.runId, "needs_decision");
    expect((await decisionOf(s.runId))?.reason).toBe("agent_failed");
    expect(await noStageJob(c, s.runId)).toBe(true);
    expect((await stageRow(c.sql, s.runId, 1)).status).toBe("pending");
  }, 30_000);

  describe("P1-27 · ngân sách token (HUB-FR-116, C1)", () => {
    it("HUB-FR-116 · P1-27 · token_budget stage 1 000, usage 1 500 ⇒ needs_decision stage_tokens", async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { key: DEF_BUDGET_S.key });
      await jobDone(c, await nextStageJob(c, s.runId), MD_AUTO, { input: 1200, output: 300 });
      await waitStatus(c.sql, s.runId, "needs_decision");
      expect((await decisionOf(s.runId))?.reason).toBe("stage_tokens");
      expect(await noStageJob(c, s.runId)).toBe(true);
    }, 30_000);

    it("HUB-FR-116 · P1-27 · token_budget run 2 000, mỗi stage 1 500 ⇒ needs_decision run_tokens", async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { key: DEF_BUDGET_R.key });
      await jobDone(c, await nextStageJob(c, s.runId), MD_AUTO, { input: 1200, output: 300 });
      await jobDone(c, await nextStageJob(c, s.runId), MD_AUTO, { input: 1200, output: 300 });
      await waitStatus(c.sql, s.runId, "needs_decision");
      expect((await decisionOf(s.runId))?.reason).toBe("run_tokens");
    }, 30_000);

    it("HUB-FR-116 · P1-27 · token_budget null, usage 1 500 ⇒ chạy tiếp stage kế", async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { key: DEFS.auto.key });
      await jobDone(c, await nextStageJob(c, s.runId), MD_AUTO, { input: 1200, output: 300 });
      const j2 = await nextStageJob(c, s.runId);
      expect((await stageRow(c.sql, s.runId, 1)).status).toBe("running");
      await jobDone(c, j2, MD_AUTO);
      await waitStatus(c.sql, s.runId, "done");
    }, 30_000);
  });

  describe("P1-28 · D11 interrupted", () => {
    it("HUB-FR-106 · P1-28 · stage running, hub.runs kết thúc > 60 s (SQL) + sweepOnce ⇒ stage waiting_timer (retry 1, INTERRUPTED), 0 decision", async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { key: DEFS.auto.key });
      const j = await nextStageJob(c, s.runId);
      await c.sql`update hub.jobs set status = 'succeeded', finished_at = now() - interval '90 seconds' where id = ${j.id}`;
      await c.sql`update hub.runs set status = 'finished', finished_at = now() - interval '90 seconds', owner = null,
          lease_until = null where id = ${j.runId}`;
      expect((await stageRow(c.sql, s.runId, 0)).status).toBe("running");
      const r = await sweep(c);
      expect(r.interrupted).toBeGreaterThanOrEqual(1);
      await expectRetrying(s.runId, "INTERRUPTED");
    }, 30_000);

    it("HUB-FR-106 · P1-28 · `POST /runs/:stage/cancel` (không phải huỷ run) ⇒ stage waiting_timer (retry 1, INTERRUPTED), 0 decision", async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { key: DEFS.auto.key });
      const j = await nextStageJob(c, s.runId);
      const res = await c.call("A", "POST", `/runs/${j.runId}/cancel`, {});
      expect(res.status).toBeLessThan(300);
      await expectRetrying(s.runId, "INTERRUPTED");
    }, 30_000);
  });

  it("HUB-FR-106 · P1-29 · K4: stage `queued` không kick (SQL) + sweepOnce ⇒ running, đúng 1 hub.runs; quét 2 vòng vẫn 1", async () => {
    needSchema(c.ready);
    const run = await insertRun(c.sql, {
      def: { ...DEFS.auto, stages: [...DEFS.auto.stages] },
      startedBy: PA.A,
      roomId: PA_FIX.room,
      stageStatus: "queued",
    });
    await c.sql`update hub.stage_runs set updated_at = now() - interval '2 minutes'
      where process_run_id = ${run.runId} and stage_idx = 0`;
    const r1 = await sweep(c);
    expect(r1.queued).toBeGreaterThanOrEqual(1);
    const st = await waitFor(
      () => stageRow(c.sql, run.runId, 0),
      (v) => v?.status === "running",
      5_000,
    );
    expect(st.status).toBe("running");
    expect((await stageHubRuns(c.sql, run.runId)).length).toBe(1);
    await sweep(c);
    expect((await stageHubRuns(c.sql, run.runId)).length).toBe(1);
    expect(st.current_run_id).toBe((await stageHubRuns(c.sql, run.runId))[0]?.id);
  }, 30_000);
});
