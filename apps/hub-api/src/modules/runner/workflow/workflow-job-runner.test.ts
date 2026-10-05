// HUB-FR-13 · WRK-FR-07 · H2a-R12 · P13 · B6 unit: sự kiện job `workflow.async` → kết cục (`outcomeOfEvent`) và kết cục →
// run (`asyncOutcome`: hạn → TIMEOUT, huỷ → stopped).
import { describe, expect, it } from "bun:test";
import type { RunEvent } from "@ai/contracts/hub";
import { asyncOutcome } from "../../commands/driver/command-async-driver";
import { syntheticFailed, ZERO_USAGE } from "../runner.rules";
import { outcomeOfEvent } from "./workflow-job-runner";

const JOB = "00000000-0000-4000-8000-000000000001";
const base = { v: 1, job_id: JOB, seq: 1, at: "2026-10-05T00:00:00.000Z" } as const;
const result = (output: Extract<RunEvent, { type: "job.result" }>["output"]): RunEvent => ({
  ...base,
  type: "job.result",
  output,
  usage: ZERO_USAGE,
  session_resumed: false,
});

describe("outcomeOfEvent", () => {
  it("job.started / job.progress → null (bỏ qua, kể cả lặp sau requeue)", () => {
    const started: RunEvent = {
      ...base,
      type: "job.started",
      worker_id: "w",
      provider_key: "dify",
    };
    expect(outcomeOfEvent(started, 3)).toBeNull();
  });
  it("job.result text → result; output khác text → UPSTREAM_ERROR invalid_output", () => {
    expect(outcomeOfEvent(result({ kind: "text", text: "xong" }), 2)).toEqual({
      kind: "result",
      seq: 2,
      text: "xong",
    });
    const agent = result({ kind: "agent_result", result: { status: "done", text: "x" } });
    expect(outcomeOfEvent(agent, 2)).toMatchObject({ kind: "failed", code: "UPSTREAM_ERROR" });
  });
  it("job.failed → mã run + trace {code, reason, status}", () => {
    const f = syntheticFailed(JOB, {
      code: "NOT_CONFIGURED",
      reason: "credential",
      message: "x",
    });
    expect(outcomeOfEvent(f, 1)).toEqual({
      kind: "failed",
      seq: 1,
      code: "NOT_CONFIGURED",
      trace: { code: "NOT_CONFIGURED", reason: "credential", status: "failed" },
    });
  });
});

describe("asyncOutcome", () => {
  it("aborted: hạn → TIMEOUT; huỷ/mất lease → stopped", () => {
    expect(asyncOutcome({ kind: "aborted", seq: 1 }, true)).toMatchObject({
      kind: "failed",
      code: "TIMEOUT",
    });
    expect(asyncOutcome({ kind: "aborted", seq: 1 }, false).kind).toBe("stopped");
  });
  it("result/failed giữ nguyên", () => {
    expect(asyncOutcome({ kind: "result", seq: 1, text: "a" }, true)).toEqual({
      kind: "finished",
      text: "a",
    });
    const trace = { code: "UPSTREAM_ERROR" };
    expect(asyncOutcome({ kind: "failed", seq: 1, code: "UPSTREAM_ERROR", trace }, false)).toEqual({
      kind: "failed",
      code: "UPSTREAM_ERROR",
      trace,
    });
  });
});
