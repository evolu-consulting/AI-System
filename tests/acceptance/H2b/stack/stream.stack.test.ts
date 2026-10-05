// WRK-FR-03 · HUB-FR-91 · HUB-H2b-AC-04/05/06/11 · H2b-R20, R23, R24, R25 · test-plan-py §3 S01–S04, S06, S07: stack
// thật — Hub (host, limit 2) + Runtime `fake-cli` (container): `#fake:stream*` (PY-04) phát `job.delta`, Runtime gom +
// XADD (PY-03), Hub đặt `payload.stream` + chuyển tiếp SSE `delta` khi step còn mở + đối chiếu S/F (B9); Dify agent
// stream do Hub (B10, MK `mk-slow-300`).
// Chạy: bun run test:h2b:stack
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { call } from "../../H1/_fixtures";
import { deltaText, isTerminal } from "../../H1/_hub";
import { setAppKey } from "../../H2a/_h2a";
import { MOCK_TEXT } from "../../H2a/_h2a2";
import {
  arrival,
  deltasOf,
  expectDeltaBeforeStepEnd,
  expectDeltaShape,
  indexOf,
  isDelta,
  jobCount,
  stepDetail,
  stepIdOf,
} from "../_stream";
import {
  agentResultOf,
  assistantContent,
  bootStackH2b,
  endOf,
  type StackH2b,
  type StackRun,
  settleStack,
  stackRun,
} from "./_stack";

const RT = "qc-h2b-stack-stream";
let st: StackH2b;
beforeAll(async () => {
  st = await bootStackH2b(RT);
}, 240_000);
afterEach(() => settleStack(st));
afterAll(async () => {
  await st?.stop();
});

/** Có ≥ 1 SSE `delta` trong `ms` (Runtime thật: rộng). */
async function firstDelta(x: StackRun, ms = 20_000): Promise<void> {
  expect(await x.s.until(isDelta, ms)).toBeDefined();
}

describe("S01 · Orchestrator answer stream end-to-end [HUB-H2b-AC-04 · H2b-R25]", () => {
  it("WRK-FR-03 · S01 · '#fake:stream=5 #fake:answer-len=300' → delta trước step.finished của step Orchestrator, mọi delta ≤ 40, nối = content = E11 [HUB-H2b-AC-04 · H2b-R25]", async () => {
    const x = await stackRun(st, "#fake:stream=5 #fake:answer-len=300 Viết đoạn S01");
    await firstDelta(x);
    const end = await endOf(x);
    expectDeltaBeforeStepEnd(x.s, await stepIdOf(st.sql, x.runId, "orchestrator"));
    expectDeltaShape(x.s);
    expect(end?.content?.length).toBe(300);
    expect(deltaText(x.s.events)).toBe(end?.content);
    expect(await assistantContent(st, x)).toBe(end?.content);
  }, 120_000);

  it("WRK-FR-03 · S01 · '#fake:stream=10' → delta đầu đến trước run.finished ≥ 200 ms (L3) [HUB-H2b-AC-04]", async () => {
    const x = await stackRun(st, "#fake:stream=10 #fake:answer-len=600 Viết đoạn S01 thời gian");
    const first = arrival(() => x.s.events.some(isDelta), 30_000);
    const last = arrival(() => x.s.events.some(isTerminal), 60_000);
    await endOf(x);
    expect((await last) - (await first)).toBeGreaterThanOrEqual(200);
  }, 120_000);
});

describe("S02 · run direct @assistant stream [HUB-H2b-AC-05]", () => {
  it("WRK-FR-03 · S02 · '@assistant #fake:stream=10 viết' → responder.key=assistant; delta trước step.finished của step agent; nối = content [HUB-H2b-AC-05]", async () => {
    const x = await stackRun(st, "@assistant #fake:stream=10 viết thư S02");
    const started = await x.s.until((e) => e.event === "run.started", 10_000);
    expect(started?.data?.responder?.key).toBe("assistant");
    await firstDelta(x);
    const end = await endOf(x);
    expectDeltaBeforeStepEnd(x.s, await stepIdOf(st.sql, x.runId, "delegate"));
    expect(deltaText(x.s.events)).toBe(end?.content);
  }, 120_000);

  it("WRK-FR-03 · S02 · '@assistant #fake:partial #fake:stream=10' → content = text + '\\n\\nPhần chưa làm được: thiếu dữ liệu' [HUB-H2b-AC-05 · H2b-R07]", async () => {
    const x = await stackRun(st, "@assistant #fake:partial #fake:stream=10 làm hai việc S02");
    await firstDelta(x);
    const end = await endOf(x);
    const res = await agentResultOf(st, x.runId, "assistant");
    expect(res?.status).toBe("partial");
    expect(end?.content).toBe(`${res?.text}\n\nPhần chưa làm được: thiếu dữ liệu`);
    expect(deltaText(x.s.events)).toBe(end?.content);
  }, 120_000);
});

describe("S03 · delegate đầu stream, pass-through [HUB-H2b-AC-05]", () => {
  it("WRK-FR-03 · S03 · '#fake:delegate=assistant #fake:stream=10' → delta khi step delegate còn mở; đúng 1 job Orchestrator; nối = content [HUB-H2b-AC-05 · H2b-R22]", async () => {
    const x = await stackRun(st, "#fake:delegate=assistant #fake:stream=10 viết bài S03");
    await firstDelta(x);
    const end = await endOf(x);
    expectDeltaBeforeStepEnd(x.s, await stepIdOf(st.sql, x.runId, "delegate"));
    expect(await jobCount(st.sql, x.runId, "orchestrator")).toBe(1);
    expect(deltaText(x.s.events)).toBe(end?.content);
  }, 120_000);
});

describe("S04 · lệch / JSON hỏng / huỷ giữa stream [HUB-H2b-AC-06 · H2b-R23]", () => {
  it("WRK-FR-03 · S04 · '#fake:stream=5 #fake:stream-diverge' → content = S (chữ đã phát), step Orchestrator detail.stream=delta_mismatch [HUB-H2b-AC-06 · H2b-R23]", async () => {
    const x = await stackRun(st, "#fake:stream=5 #fake:stream-diverge viết S04");
    await firstDelta(x);
    const end = await endOf(x);
    expect(deltaText(x.s.events)).toBe(end?.content);
    expect((await stepDetail(st.sql, x.runId, "orchestrator"))?.stream).toBe("delta_mismatch");
  }, 120_000);

  it("WRK-FR-03 · S04 · Orchestrator '#fake:stream=5 #fake:stream-badjson' → run.finished content = S, stream_unparsed, đúng 1 job Orchestrator [H2b-R23 · P12]", async () => {
    const x = await stackRun(st, "#fake:stream=5 #fake:stream-badjson viết S04");
    await firstDelta(x);
    const end = await endOf(x);
    expect(deltaText(x.s.events)).toBe(end?.content);
    expect((await stepDetail(st.sql, x.runId, "orchestrator"))?.stream).toBe("stream_unparsed");
    expect(await jobCount(st.sql, x.runId, "orchestrator")).toBe(1);
  }, 120_000);

  it("WRK-FR-03 · S04 · '#fake:stream=50' huỷ sau delta đầu → run.failed CANCELLED ≤ 5 s [HUB-H2b-AC-06]", async () => {
    const x = await stackRun(st, "#fake:stream=50 #fake:answer-len=2000 viết dài S04");
    await firstDelta(x);
    const t0 = Date.now();
    const res = await call(st.hub, "POST", `/runs/${x.runId}/cancel`, {
      token: await st.token("lan"),
    });
    expect(res.status).toBe(200);
    expect((await endOf(x, "run.failed", 10_000))?.code).toBe("CANCELLED");
    expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
  }, 120_000);
});

describe("S06 · text trước khoá vai → không delta sớm [H2b-R20]", () => {
  it("WRK-FR-03 · S06 · '#fake:stream=5 #fake:stream-order=text-first' → 0 delta trước step.finished của step Orchestrator; content đúng [H2b-R20]", async () => {
    const x = await stackRun(st, "#fake:stream=5 #fake:stream-order=text-first viết S06");
    const end = await endOf(x);
    const stepId = await stepIdOf(st.sql, x.runId, "orchestrator");
    const stepEnd = indexOf(x.s, (e) => e.event === "step.finished" && e.data?.step_id === stepId);
    expect(stepEnd).toBeGreaterThanOrEqual(0);
    expect(x.s.events.slice(0, stepEnd).filter(isDelta)).toEqual([]);
    expect(String(end?.content ?? "")).toContain("S06");
    expect(deltaText(x.s.events)).toBe(end?.content);
  }, 120_000);
});

describe("S07 · agent Dify stream qua Hub [HUB-H2b-AC-11 · H2b-R24]", () => {
  it("WRK-FR-03 · S07 · '@dify-tro-ly hỏi' (mk-slow-300) → responder dify-tro-ly; delta đầu sớm hơn run.finished ≥ 600 ms; content = MK [HUB-H2b-AC-11 · H2b-R24]", async () => {
    await setAppKey(st.sql, "troLy", "mk-slow-300");
    const x = await stackRun(st, "@dify-tro-ly hỏi lịch nghỉ S07");
    const first = arrival(() => x.s.events.some(isDelta), 30_000);
    const last = arrival(() => x.s.events.some(isTerminal), 60_000);
    const end = await endOf(x);
    expect((await x.s.until((e) => e.event === "run.started", 1_000))?.data?.responder?.key).toBe(
      "dify-tro-ly",
    );
    expect(deltasOf(x.s).length).toBeGreaterThanOrEqual(1);
    expect((await last) - (await first)).toBeGreaterThanOrEqual(600);
    expect(end?.content).toBe(MOCK_TEXT);
  }, 120_000);
});
