// HUB-FR-43 · HUB-H1-AC-H06 · UC-04 · H1-R14, H1-R22 · test-plan H1 §6 S1: stack thật (hub-api process + agent-runtime
// container, `fake-cli`) — huỷ run đang chạy `#fake:sleep=60` → ≤ 5 s `run.failed CANCELLED`, job `cancelled`.
// Chạy: bun --env-file=.env.local test --timeout 120000 tests/acceptance/H1/stack
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call, waitFor } from "../_fixtures";
import { insertConv, runIdOf, send } from "../_hub";
import { bootStack, type Stack } from "./_stack";

let s: Stack;
beforeAll(async () => {
  s = await bootStack("qc-h1-stack-cancel");
}, 180_000);
afterAll(async () => {
  await s?.stop();
});

describe("S1 · huỷ run Runtime thật [HUB-H1-AC-H06]", () => {
  it("S1 · #fake:delegate=assistant #fake:sleep=60 → E15 → ≤ 5 s run.failed CANCELLED, job cancelled [HUB-H1-AC-H06]", async () => {
    const conv = await insertConv(s.sql, "lan", "a3000000-0000-4000-8000-000000000101");
    const token = await s.token("lan");
    const sse = await send(s.hub, token, conv, "#fake:delegate=assistant #fake:sleep=60 Việc lâu");
    expect(sse.status).toBe(200);
    const runId = runIdOf(sse);

    const jobs = () => s.sql<{ status: string }[]>`select status from hub.jobs
      where run_id = ${runId} order by created_at, id`;
    // job agent (thứ 2) đang chạy thật trong container
    const running = await waitFor(jobs, (j) => j.length >= 2 && j[1]?.status === "running", 30_000);
    expect(running.map((j) => j.status)).toEqual(["succeeded", "running"]);

    const t0 = Date.now();
    const res = await call(s.hub, "POST", `/runs/${runId}/cancel`, { token });
    expect(res.status).toBe(200);
    const end = await sse.terminal(5_000);
    sse.close();
    expect(Date.now() - t0).toBeLessThanOrEqual(5_500);
    expect(end?.event).toBe("run.failed");
    expect(end?.data).toMatchObject({ code: "CANCELLED" });
    const done = await waitFor(jobs, (j) => j[1]?.status === "cancelled", 5_000);
    expect(done.map((j) => j.status)).toEqual(["succeeded", "cancelled"]);
  });
});
