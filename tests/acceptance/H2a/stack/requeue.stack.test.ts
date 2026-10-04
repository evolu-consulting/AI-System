// WRK-FR-06 · AC-W06 · H2a-R13 · RT4 · test-plan H2a cases §5 S03: stack thật — `/dich-async` (job `workflow.async`,
// MK `mk-slow-2000`) đang chạy trong Runtime (`fake-cli,dify`) → `kill -9` container → Runtime mới
// (`AGENT_RT_ORPHAN_S=5`, `AGENT_RT_HEARTBEAT_S=1`) requeue + chạy lại → client thấy đúng một `run.finished` (text MK), job `attempts=2`.
// Chạy: bun run test:h2a:stack
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type Json, waitFor } from "../../H1/_fixtures";
import { insertConv, runIdOf, send } from "../../H1/_hub";
import { setAppKey } from "../_h2a";
import { MOCK_TEXT } from "../_h2a2";
import { bootStackH2a, type StackH2a } from "./_stack";

const RT = "qc-h2a-stack-requeue";
const PROVIDERS = "fake-cli,dify";
let s: StackH2a;
beforeAll(async () => {
  s = await bootStackH2a(RT);
  await setAppKey(s.sql, "dich", "mk-slow-2000");
}, 180_000);
afterAll(async () => {
  await s?.stop();
});

describe("S03 · kill -9 Runtime giữa job workflow.async → requeue, một run.finished [AC-W06]", () => {
  it("WRK-FR-06 · S03 · /dich-async mk-slow, kill9 Runtime → Runtime mới chạy lại → đúng 1 run.finished, attempts=2 [AC-W06]", async () => {
    const rt = await s.runtime(`${RT}-1`, PROVIDERS);
    const conv = await insertConv(s.sql, "lan", "a2a30000-0000-4000-8000-000000000301");
    const sse = await send(s.hub, await s.token("lan"), conv, "/dich-async en xin chào");
    expect(sse.status).toBe(200);
    const runId = runIdOf(sse);
    const jobs = () =>
      s.sql<Json[]>`select id, status, attempts, type from hub.jobs where run_id = ${runId}`;
    const running = await waitFor(
      jobs,
      (j) => j[0]?.status === "running" && s.dify.runs().length >= 1,
      30_000,
    );
    expect(running.map((j) => [j.type, j.status])).toEqual([["workflow.async", "running"]]);

    rt.kill9();
    // TC-5: ngưỡng orphan phải > chu kỳ heartbeat (mặc định 10 s) — không thì Runtime mới requeue chính job nó vừa
    // claim (mk-slow-2000 chạy > 5 s) → claim lần 3. Heartbeat 1 s giữ đúng tỉ lệ prod (orphan 60 / heartbeat 10).
    await s.runtime(`${RT}-2`, PROVIDERS, { AGENT_RT_ORPHAN_S: "5", AGENT_RT_HEARTBEAT_S: "1" });
    const end = await sse.terminal(90_000);
    sse.close();
    expect(end?.event).toBe("run.finished");
    expect(end?.data?.content).toBe(MOCK_TEXT);
    expect(sse.events.filter((e) => e.event === "run.finished").length).toBe(1);
    const [job] = await jobs();
    expect({ status: job?.status, attempts: job?.attempts }).toEqual({
      status: "succeeded",
      attempts: 2,
    });
    expect(s.dify.runs().length).toBe(2);
  }, 240_000);
});
