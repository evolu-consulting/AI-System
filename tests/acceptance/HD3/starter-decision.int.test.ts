// HD-FR-34 · AC34a · D3-07 (N2-D06 mở rộng, người dùng chốt 2026-10-19): stage `exclude_starter` (cấp 2) rơi `needs_decision`
// lý do KHÔNG thuộc nhóm duyệt (`permission_lost` — `use_current` luôn được đưa ra) ⇒ người bắt đầu chọn `use_current` (= coi như
// Đạt, lách cấp 2) ⇒ 403 STARTER_CANNOT_REVIEW, stage không đi tiếp; người bắt đầu vẫn `cancel` được; admin không bị chặn.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxN2, errCode, startN2 } from "../N2/_n2";
import {
  agentStage,
  createDef,
  decide,
  decisionOf,
  defBody,
  G1,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
  P1,
  PA,
  runRow,
  startRun,
  waitStatus,
} from "../P-d/_support/pd";

let c: CtxN2;
beforeAll(async () => {
  c = await startN2({ processRunsPerTenant: 200 });
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

let seq = 0;
/** s0 auto (hd-read) → s1 review G1 `exclude_starter` (hd-post); thu grant hd-post của A trước khi s0 xong ⇒ s1 permission_lost. */
async function toLevel2Decision(): Promise<string> {
  const key = `hd3-sd-${++seq}`;
  const after: Json = { kind: "review", group_id: G1, back_to_steps: [], exclude_starter: true };
  await createDef(
    c,
    defBody(key, [
      agentStage({ key: "s0", step: 0 }),
      agentStage({
        key: "s1",
        step: 1,
        after,
        executor: { kind: "agent", agent_id: P1.agPost },
      }),
    ]),
  );
  const runId = await startRun(c, key);
  const job = await nextStageJob(c, runId);
  await c.sql`delete from hub.agent_grants where agent_id = ${P1.agPost} and subject_id = ${PA.A.id}`;
  await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  await jobDone(c, job, mdOut());
  await waitStatus(c.sql, runId, "needs_decision");
  expect((await decisionOf(c.sql, runId))?.reason).toBe("permission_lost");
  return runId;
}

async function regrant(): Promise<void> {
  await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    values (${P1.agPost}, ${PA.A.tid}, 'user', ${PA.A.id}) on conflict do nothing`;
  await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

describe("AC34a · người bắt đầu không `use_current` ở stage cấp 2 [HD-FR-34]", () => {
  it("D3-07 · A (người bắt đầu) use_current ⇒ 403 STARTER_CANNOT_REVIEW, run vẫn needs_decision; Adm không bị chặn", async () => {
    const runId = await toLevel2Decision();
    try {
      const no = await decide(c, "A", runId, "use_current");
      expect({ status: no.status, code: errCode(no) }).toEqual({
        status: 403,
        code: "STARTER_CANNOT_REVIEW",
      });
      expect((await runRow(c.sql, runId))?.status).toBe("needs_decision");
      // Người khác không bị luật người bắt đầu: Adm use_current đi qua kiểm D3-07 (engine trả 409 NO_OUTPUT vì stage
      // chưa có output — luật P-a), còn add_attempt ⇒ 200.
      const other = await decide(c, "Adm", runId, "use_current");
      expect({ status: other.status, code: errCode(other) }).toEqual({
        status: 409,
        code: "NO_OUTPUT",
      });
      await regrant();
      const ok = await decide(c, "Adm", runId, "add_attempt");
      expect({ status: ok.status, code: errCode(ok) }).toEqual({ status: 200, code: null });
    } finally {
      await regrant();
    }
  }, 60_000);

  it("review m9 · thẻ decision của A (người bắt đầu) KHÔNG có use_current; add_attempt/cancel còn", async () => {
    const runId = await toLevel2Decision();
    try {
      const v = await c.call("A", "GET", `/process-runs/${runId}`);
      const d = ((v.json?.my_tasks ?? []) as Json[]).find((t) => t.kind === "decision");
      expect({ seen: d !== undefined, can_act: d?.can_act }).toEqual({ seen: true, can_act: true });
      expect(d?.options).toEqual(["add_attempt", "cancel"]);
    } finally {
      await regrant();
    }
  }, 60_000);

  it("D3-07 · A (người bắt đầu) cancel vẫn được (không là duyệt) ⇒ 200, run cancelled", async () => {
    const runId = await toLevel2Decision();
    try {
      const r = await decide(c, "A", runId, "cancel");
      expect({ status: r.status, code: errCode(r) }).toEqual({ status: 200, code: null });
      expect((await runRow(c.sql, runId))?.status).toBe("cancelled");
    } finally {
      await regrant();
    }
  }, 60_000);
});
