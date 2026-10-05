// HUB-BR-04 · WRK-FR-15 · H3a-R07, R08, R09 · F1 · HUB-H3a-AC-06 · test-plan-cases H3a §2.3 A14–A17: job đã chạy fail
// `ALL_PROVIDERS_EXHAUSTED` với `jobs.error_reason` ⇒ `run.failed` câu theo reason (quota/provider_unavailable ⇒ R08,
// khác/null ⇒ câu H1); Orchestrator không delegate lại (R07 vế Hub); job agent trực tiếp (H2b) đã stream rồi fail ⇒ 1 kết thúc.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { JobFailReason } from "@ai/contracts/hub";
import { terminalCount } from "../H1/_hub";
import { ScriptRuntime3, settleRuns } from "../H2b/_h2b";
import { expectDeltas } from "../H2b/_stream";
import { endOf, H1_EXHAUSTED, type H3aCtx, jobsOfRun, R08, startH3a, startRun } from "./_h3a";

let x: H3aCtx;
let rt3: ScriptRuntime3;
beforeAll(async () => {
  x = await startH3a();
  rt3 = new ScriptRuntime3(x.sql, x.redis, "qc-rt-h3a");
}, 60_000);
afterEach(() => settleRuns(x.hub, x.sql, x.k));
afterAll(() => x?.stop());

/** Job Orchestrator fail EXHAUSTED + `reason`; trả dữ liệu `run.failed` + job của run. */
async function orchFails(who: "lan" | "hoa", reason: JobFailReason | null, label: string) {
  const r = await startRun(x, who, `Câu ${label}`);
  const job = await x.rt.next(r.runId);
  expect(job.payload.agent.role).toBe("orchestrator");
  await x.rt.fail(job, "ALL_PROVIDERS_EXHAUSTED", "hết hạn mức (nội bộ)", reason);
  const end = await endOf(r.s);
  expect(end.event).toBe("run.failed");
  expect(end.data?.code).toBe("ALL_PROVIDERS_EXHAUSTED");
  return { end, jobs: await jobsOfRun(x.sql, r.runId) };
}
const textOf = (d: { message?: string; hint?: string } | undefined) => ({
  message: d?.message,
  hint: d?.hint,
});

describe("A14–A16 · job Orchestrator fail theo reason [H3a-R07 · H3a-R08 · HUB-H3a-AC-06]", () => {
  for (const [who, locale] of [
    ["lan", "vi"],
    ["hoa", "en"],
  ] as const)
    it(`HUB-BR-04 · A14 · Orchestrator ALL_PROVIDERS_EXHAUSTED + quota (${locale}) → run.failed câu R08 quota; đúng 1 job (không delegate lại) [H3a-R07 · H3a-R08 · HUB-H3a-AC-05 · HUB-H3a-AC-06]`, async () => {
      const r = await orchFails(who, "quota", `A14 ${locale}`);
      expect(r.jobs.length).toBe(1);
      expect(textOf(r.end.data)).toEqual(R08.quota[locale]);
    });

  it("HUB-BR-04 · A15 · Orchestrator ALL_PROVIDERS_EXHAUSTED + provider_unavailable (vi) → câu R08 provider_unavailable [H3a-R08 · HUB-H3a-AC-06]", async () => {
    const r = await orchFails("lan", "provider_unavailable", "A15");
    expect(r.jobs.length).toBe(1);
    expect(textOf(r.end.data)).toEqual(R08.provider_unavailable.vi);
  });

  for (const reason of ["provider_busy", null] as const)
    it(`HUB-BR-04 · A16 · Orchestrator ALL_PROVIDERS_EXHAUSTED + ${reason ?? "null"} → câu H1 giữ nguyên [H3a-R08 · H3a-R19]`, async () => {
      const r = await orchFails("lan", reason, `A16 ${reason}`);
      expect(textOf(r.end.data)).toEqual(H1_EXHAUSTED.vi);
    });
});

describe("A17 · job agent trực tiếp (@assistant) stream rồi fail quota [H3a-R08 · H2b-R23]", () => {
  it("HUB-BR-04 · A17 · @assistant: delta trước, rồi job.failed ALL_PROVIDERS_EXHAUSTED quota → run.failed câu R08 quota, đúng 1 sự kiện kết thúc, 1 job [H3a-R08 · HUB-H3a-AC-06]", async () => {
    const r = await startRun(x, "lan", "@assistant Việc A17");
    const job = await rt3.next(r.runId);
    expect(job.payload.agent.role).toBe("agent");
    await rt3.delta(job, "done", "Đang trả lời A17");
    await expectDeltas(r.s, 1, 3_000);
    await rt3.fail(job, "ALL_PROVIDERS_EXHAUSTED", "hết hạn mức (nội bộ)", "quota");
    const end = await endOf(r.s);
    expect(end.event).toBe("run.failed");
    expect(end.data?.code).toBe("ALL_PROVIDERS_EXHAUSTED");
    expect(textOf(end.data)).toEqual(R08.quota.vi);
    expect(await terminalCount(x.redis, r.runId)).toBe(1);
    expect((await jobsOfRun(x.sql, r.runId)).length).toBe(1);
  });
});
