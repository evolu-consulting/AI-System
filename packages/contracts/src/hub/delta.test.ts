// HUB-FR-92, WRK-FR-03 · H2b C2 (plan §2.2): `job.delta`, `AgentCliJob.stream?`, lý do `refused`.
import { describe, expect, test } from "bun:test";
import { JOB_DELTA_TEXT_MAX, JOB_FAIL_REASONS, JobPayloadSchema, RunEventSchema } from "./index";

const delta = {
  v: 1,
  job_id: "11111111-1111-4111-8111-111111111111",
  seq: 1,
  at: "2026-10-04T08:00:00.000+07:00",
  type: "job.delta",
  kind: "answer",
  text: "xin chào",
} as const;

describe("hub contract H2b", () => {
  test("job.delta: kind ∈ answer/done/partial, text 1–4000", () => {
    expect(RunEventSchema.parse(delta)).toEqual(delta);
    // zod 4.6 đếm code point (khác ghi chú plan §2.2 "UTF-16") — cắt UTF-16 ≤ 4000 vẫn hợp lệ.
    const emoji = "😀".repeat(JOB_DELTA_TEXT_MAX);
    expect(RunEventSchema.safeParse({ ...delta, text: emoji }).success).toBe(true);
    expect(RunEventSchema.safeParse({ ...delta, text: `${emoji}a` }).success).toBe(false);
    const ascii = "a".repeat(JOB_DELTA_TEXT_MAX + 1);
    expect(RunEventSchema.safeParse({ ...delta, text: ascii }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...delta, kind: "thinking" }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...delta, usage: null }).success).toBe(false);
  });

  test("AgentCliJob.stream tuỳ chọn, chỉ boolean", async () => {
    const base = await Bun.file(
      new URL("../../fixtures/hub/valid/JobPayload.agent.json", import.meta.url),
    ).json();
    expect(JobPayloadSchema.safeParse(base).success).toBe(true);
    expect(JobPayloadSchema.safeParse({ ...base, stream: false }).success).toBe(true);
    expect(JobPayloadSchema.safeParse({ ...base, stream: "true" }).success).toBe(false);
  });

  test("JOB_FAIL_REASONS: refused (H2b) rồi attachment (H2c) ở cuối", () => {
    expect(JOB_FAIL_REASONS.at(-2)).toBe("refused");
    expect(JOB_FAIL_REASONS.at(-1)).toBe("attachment");
    expect(JOB_FAIL_REASONS).toHaveLength(15);
  });
});
