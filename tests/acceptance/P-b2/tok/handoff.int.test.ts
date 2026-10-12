// HUB-FR-136 (SHOULD) · HUB-FR-106 · AC-PB2-09 · test-plan-cases §3.5 `tok/handoff` (HO-01…HO-07): prompt stage bước sau có
// khối "Bàn giao từ bước trước:" lấy mục `## Bàn giao` (đọc từ `process_outputs.content` bằng `sectionMap`, cắt 800 ký tự,
// cờ `OutputRef.handoff_truncated`), KHÔNG nhúng nguyên file (file vẫn đính kèm); def lưu qua API thiếu mục ⇒ template_invalid.
// DB tag `pb2_tok`. 0024 vắng ⇒ đỏ ở `needPb2`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { MD_OK } from "../../P-a/pf1/_local";
import {
  attachNames,
  backToB3,
  type CtxPb2,
  defBody,
  finishStages,
  type Json,
  jobDone,
  jobOfStage,
  MD_HO,
  MD_LONGHO,
  MD_NOHO,
  mdWithHandoff,
  needPb2,
  P1,
  parToStep1,
  passStage,
  promptOf,
  review,
  settleRuns,
  st,
  startInRoom,
  startPb2,
  viewOf,
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

const truncOf = async (runId: string, idx: number): Promise<boolean | undefined> => {
  const v = (await viewOf(c, "A", runId)).json;
  const s = ((v?.stages ?? []) as Json[]).find((x) => x.idx === idx);
  return (s?.outputs as Json[] | undefined)?.at(-1)?.handoff_truncated;
};

describe("HO · Bàn giao vào prompt [AC-PB2-09][HUB-FR-136]", () => {
  it("AC-PB2-09 · HO-01 · stage 0 MD_HO ⇒ prompt bước 1 có 'Bàn giao từ bước trước:', HANDOFF-OK, 's0-v1-'; KHÔNG có BODY-ONLY-7f3a; file s0 vẫn đính kèm", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    const j = await jobOfStage(c, runId, 1);
    const p = promptOf(j);
    expect(p).toContain("Bàn giao từ bước trước:");
    expect(p).toContain("HANDOFF-OK");
    expect(p).toContain("s0-v1-");
    expect(p).not.toContain("BODY-ONLY-7f3a");
    expect(attachNames(j).some((n) => n.startsWith("s0-v1-"))).toBe(true);
  }, 60_000);
  it("HUB-FR-136 · HO-02 · Bàn giao 900 ký tự ⇒ prompt 800 'H' + '…' (không 801); handoff_truncated true; MD_HO ⇒ false", async () => {
    needPb2(c.pb2);
    const a = await parToStep1(c, { md: MD_LONGHO });
    const p = promptOf(await jobOfStage(c, a.runId, 1));
    expect(p).toContain(`${"H".repeat(800)}…`);
    expect(p).not.toContain("H".repeat(801));
    expect(await truncOf(a.runId, 0)).toBe(true);
    const b = await parToStep1(c);
    expect(await truncOf(b.runId, 0)).toBe(false);
  }, 60_000);
  it("AC-PB2-09 · HO-03 · def lưu qua POST /process-defs (ensureHandoff) + output thiếu 'Bàn giao' 4 lần ⇒ needs_decision template_invalid", async () => {
    needPb2(c.pb2);
    const body = defBody("pb2-ho03", [st({ key: "a", name: "Đọc", agent: P1.agRead })]);
    const r = await c.call("Adm", "POST", "/process-defs", body);
    expect(r.status).toBe(201);
    const s = await startInRoom(c, { key: "pb2-ho03" });
    for (let i = 0; i < 4; i++) await jobDone(c, await jobOfStage(c, s.runId, 0), MD_NOHO);
    await waitStatus(c.sql, s.runId, "needs_decision");
    expect((await viewOf(c, "A", s.runId)).json?.decision?.reason).toBe("template_invalid");
  }, 60_000);
  it("AC-PB2-01 · HO-04 · def SQL cũ (hoa-don-t) + output không 'Bàn giao' ⇒ template ok; prompt stage sau KHÔNG có 'Bàn giao từ bước trước:'", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c);
    await jobDone(c, await jobOfStage(c, s.runId, 0), MD_OK);
    await passStage(c, s.runId, 0, "B");
    const p = promptOf(await jobOfStage(c, s.runId, 1));
    expect(p).not.toContain("Bàn giao từ bước trước:");
  }, 60_000);
  it("HUB-FR-136 · HO-05 · sau quay lại: Bàn giao v2 của B1 thay v1 ở prompt bước sau", async () => {
    needPb2(c.pb2);
    const g = await backToB3(c, (i) => mdWithHandoff(i === 1 ? "B1-HANDOFF-V1" : `HANDOFF-B${i}`));
    expect(
      (await review(c, "B", g.taskId, { result: "fail", feedback: "Sửa B1", back_to_step: 1 }))
        .status,
    ).toBe(200);
    await jobDone(c, await jobOfStage(c, g.runId, 1), mdWithHandoff("B1-HANDOFF-V2"));
    await passStage(c, g.runId, 1, "B");
    const p = promptOf(await jobOfStage(c, g.runId, 2));
    expect(p).toContain("B1-HANDOFF-V2");
    expect(p).not.toContain("B1-HANDOFF-V1");
  }, 90_000);
  it("HUB-FR-136 · HO-06 · stage bước 2 nhận Bàn giao của CẢ 2 stage bước 1 (### Rà soát code, ### Test hồi quy)", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    await jobDone(c, await jobOfStage(c, runId, 1), mdWithHandoff("HANDOFF-RA-SOAT"));
    await jobDone(c, await jobOfStage(c, runId, 2), mdWithHandoff("HANDOFF-HOI-QUY"));
    await passStage(c, runId, 1, "B");
    await passStage(c, runId, 2, "T");
    const p = promptOf(await jobOfStage(c, runId, 3));
    for (const x of ["### Rà soát code", "### Test hồi quy", "HANDOFF-RA-SOAT", "HANDOFF-HOI-QUY"])
      expect(p).toContain(x);
  }, 60_000);
  it("HUB-FR-136 · HO-07 · Bàn giao đọc từ content (sectionMap), không từ cột sections: sections=NULL trước bước sau ⇒ prompt vẫn có HANDOFF-OK", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: "pb2-par" });
    await finishStages(c, s.runId, [0], MD_LONGHO);
    await waitStage(c.sql, s.runId, 0, "waiting_review");
    await c.sql`update hub.process_outputs set sections = null where process_run_id = ${s.runId}`;
    expect(await truncOf(s.runId, 0)).toBe(true);
    await passStage(c, s.runId, 0, "B");
    expect(promptOf(await jobOfStage(c, s.runId, 1))).toContain(`${"H".repeat(800)}…`);
    const s2 = await startInRoom(c, { key: "pb2-par" });
    await finishStages(c, s2.runId, [0], MD_HO);
    await waitStage(c.sql, s2.runId, 0, "waiting_review");
    await c.sql`update hub.process_outputs set sections = ${c.sql.json({ "Bàn giao": "SAI-TU-COT" })}
      where process_run_id = ${s2.runId}`;
    await passStage(c, s2.runId, 0, "B");
    const p = promptOf(await jobOfStage(c, s2.runId, 1));
    expect(p).toContain("HANDOFF-OK");
    expect(p).not.toContain("SAI-TU-COT");
  }, 60_000);
});
