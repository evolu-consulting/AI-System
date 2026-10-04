// HUB-FR-42 · WRK-FR-23 · HUB-H1-AC-04 · H1-R20 · test-plan H1 §6 S3: stack thật — `kill -9` Runtime (container) khi job
// `running` → ≤ 90 s `run.failed INTERNAL_ERROR`; flow không kẹt `FLOW_BUSY`, gửi tiếp được.
// `docker kill -s KILL` = SIGKILL tiến trình cha (PID 1 của container; trong container không tự `kill -9 1` được).
// Chạy: bun --env-file=.env.local test --timeout 120000 tests/acceptance/H1/stack
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { waitFor } from "../_fixtures";
import { insertConv, runIdOf, send } from "../_hub";
import { bootStack, type Stack, startRuntimeBox } from "./_stack";

let s: Stack;
beforeAll(async () => {
  s = await bootStack("qc-h1-stack-orphan");
}, 180_000);
afterAll(async () => {
  await s?.stop();
});

describe("S3 · kill -9 Runtime [HUB-H1-AC-04]", () => {
  it("S3 · kill -9 khi job running → ≤ 90 s run.failed INTERNAL_ERROR; flow gửi tiếp được, chạy xong [HUB-H1-AC-04]", async () => {
    const conv = await insertConv(s.sql, "lan", "a3000000-0000-4000-8000-000000000301");
    const token = await s.token("lan");
    const sse = await send(
      s.hub,
      token,
      conv,
      "#fake:delegate=assistant #fake:sleep=300 Việc rất lâu",
    );
    expect(sse.status).toBe(200);
    const runId = runIdOf(sse);
    const flowId = sse.headers.get("x-flow-id") ?? "";
    const jobs = () => s.sql<{ status: string }[]>`select status from hub.jobs
      where run_id = ${runId} order by created_at, id`;
    const running = await waitFor(jobs, (j) => j.length >= 2 && j[1]?.status === "running", 30_000);
    expect(running.map((j) => j.status)).toEqual(["succeeded", "running"]);

    s.rt.kill9();
    const t0 = Date.now();
    const end = await sse.terminal(90_000);
    sse.close();
    expect(Date.now() - t0).toBeLessThanOrEqual(90_000);
    expect(end?.event).toBe("run.failed");
    expect(end?.data).toMatchObject({ code: "INTERNAL_ERROR" });

    // flow không kẹt FLOW_BUSY: Runtime mới nhận, tin kế chạy xong
    s.rt = await startRuntimeBox("qc-h1-stack-orphan", "qc-h1-stack-orphan-2");
    const next = await send(s.hub, token, conv, "Xin chào lại", flowId);
    expect(next.status).toBe(200);
    const end2 = await next.terminal(60_000);
    next.close();
    expect(end2?.event).toBe("run.finished");
  }, 240_000);
});
