// HUB-FR-143 · AC-H39 · test-plan-rules PD-U93…U98: cách vào lại team_run khi chạy lại stage team
// `P/domain/runs/team-retry.rules.ts` `teamResumePlan` (plan-addendum A5; đầu vào có `cursor`, `cursor < 0` ⇒ new). Module vắng ⇒ đỏ.
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const REL = "runs/team-retry.rules.ts";
const N = new Date("2026-10-19T01:00:00.000Z");
const plan = () => domainFn(REL, "teamResumePlan");

describe("PD-U93…U98 · teamResumePlan [plan-addendum A5]", () => {
  it("AC-H39 · PD-U93 · null (chưa có team-run) ⇒ new", async () => {
    expect((await plan())(null)).toBe("new");
  });
  it("AC-H39 · PD-U94 · running + segmentStartedAt null + cursor 0 (đã pauseForRetry) ⇒ resume_retry", async () => {
    expect((await plan())({ status: "running", segmentStartedAt: null, cursor: 0 })).toBe(
      "resume_retry",
    );
  });
  it("AC-H39 · PD-U95 · waiting_answer (segmentStartedAt null hoặc N) ⇒ resume_answer (ưu tiên hơn retry)", async () => {
    const f = await plan();
    expect([
      f({ status: "waiting_answer", segmentStartedAt: null, cursor: 0 }),
      f({ status: "waiting_answer", segmentStartedAt: N, cursor: 0 }),
    ]).toEqual(["resume_answer", "resume_answer"]);
  });
  it("AC-H39 · PD-U96 · running + segmentStartedAt N (đang chạy dở, không do retry) ⇒ new", async () => {
    expect((await plan())({ status: "running", segmentStartedAt: N, cursor: 0 })).toBe("new");
  });
  it.each(
    ["done", "limit", "failed", "cancelled"].flatMap((status) =>
      [null, N].map((seg) => [status, seg === null ? "null" : "N", seg] as const),
    ),
  )(
    "AC-H39 · PD-U97 · %s × segmentStartedAt %s ⇒ new; thuần, không đổi đầu vào",
    async (status, _l, seg) => {
      const f = await plan();
      const cur = { status, segmentStartedAt: seg, cursor: 0 };
      const snap = structuredClone(cur);
      expect(f(cur)).toBe("new");
      expect(f(cur)).toBe("new");
      expect(cur).toEqual(snap);
    },
  );
  it("AC-H39 · PD-U98 · running + null + cursor −1 (dữ liệu hỏng) ⇒ new; đối chứng cursor 0 ⇒ resume_retry", async () => {
    const f = await plan();
    expect([
      f({ status: "running", segmentStartedAt: null, cursor: -1 }),
      f({ status: "running", segmentStartedAt: null, cursor: 0 }),
    ]).toEqual(["new", "resume_retry"]);
  });
});
