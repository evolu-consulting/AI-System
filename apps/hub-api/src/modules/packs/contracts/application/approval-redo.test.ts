// M3c · review B #27/#28/#29 (unit, repo giả): "Trích lại" trừ quota SAU `decide` và chỉ khi thật sự trích lại (người không phải
// người duyệt / thiếu lý do ⇒ không trừ); AI chưa sẵn sàng ⇒ `unavailable` (503) trước khi ghi, không trừ quota, không xếp job;
// feedback chứa ký tự điều khiển (NUL) bị schema chặn ở biên.
import { describe, expect, test } from "bun:test";
import { ApprovalActionRequestSchema } from "@ai/contracts";
import { APPROVAL_DEFAULTS } from "../domain/approval-def.rules";
import type { ApprovalTxRepos, ApprovalUow } from "./approval.ports";
import { type ApprovalDeps, actApproval, type ExtractJob } from "./approval.usecase";

const T = "00000000-0000-4000-8000-000000000001";
const A = "00000000-0000-4000-8000-0000000000a1";
const C = "00000000-0000-4000-8000-0000000000c1";
const RUN = "00000000-0000-4000-8000-0000000000d1";

function harness(o: { inLevel1: boolean; ready: boolean }) {
  const calls = { quota: 0, marked: 0, jobs: [] as ExtractJob[] };
  const repos = {
    approval: {
      settings: async () => APPROVAL_DEFAULTS,
      state: async () => ({
        runId: RUN,
        status: "needs_review",
        hasSource: true,
        version: 1,
        approval: { id: RUN, status: "level1", startedBy: A, feedback: null },
        value: 1,
        threshold: 100,
      }),
      markExtracting: async () => {
        calls.marked += 1;
        return true;
      },
      statusOf: async () => "extracting",
    },
    outbox: { enqueue: async () => undefined },
  } as unknown as ApprovalTxRepos;
  const uow = { tenant: (_w: unknown, fn: (r: ApprovalTxRepos) => unknown) => fn(repos) };
  const d: ApprovalDeps = {
    uow: uow as unknown as ApprovalUow,
    groups: {
      idsOf: async () => new Map([[APPROVAL_DEFAULTS.level1GroupKey, "g1"]]),
      userGroups: async () => new Set(o.inLevel1 ? ["g1"] : []),
    },
    jobs: { enqueue: async (j) => void calls.jobs.push(j) },
    redo: {
      ready: o.ready,
      quota: async () => {
        calls.quota += 1;
      },
    },
  };
  return { act: actApproval(d), calls };
}
const who = { tenantId: T, userId: A };

describe("M3c · Trích lại: quota và AI sẵn sàng sau decide [review B #27, #28]", () => {
  test("người duyệt + lý do ⇒ trừ quota MỘT lần, HĐ về extracting, xếp job", async () => {
    const h = harness({ inLevel1: true, ready: true });
    await h.act(who, C, { action: "redo", feedback: "đọc lại" });
    expect(h.calls).toMatchObject({ quota: 1, marked: 1 });
    expect(h.calls.jobs).toHaveLength(1);
  });
  test("không phải người duyệt / thiếu lý do ⇒ lỗi, KHÔNG trừ quota", async () => {
    const h = harness({ inLevel1: false, ready: true });
    expect(await h.act(who, C, { action: "redo", feedback: "x" })).toEqual({
      error: "NOT_REVIEWER",
    });
    const h2 = harness({ inLevel1: true, ready: true });
    expect(await h2.act(who, C, { action: "redo" })).toEqual({ error: "FEEDBACK_REQUIRED" });
    expect(h.calls.quota + h2.calls.quota).toBe(0);
  });
  test("AI chưa cấu hình ⇒ unavailable, không trừ quota, không ghi, không xếp job", async () => {
    const h = harness({ inLevel1: true, ready: false });
    expect(await h.act(who, C, { action: "redo", feedback: "x" })).toBe("unavailable");
    expect(h.calls).toEqual({ quota: 0, marked: 0, jobs: [] });
  });
});

describe("M3c · feedback chặn ký tự điều khiển [review B #29]", () => {
  test("NUL / \\u0007 ⇒ không hợp lệ; xuống dòng / tab giữ", () => {
    expect(
      ApprovalActionRequestSchema.safeParse({ action: "reject", feedback: "a\u0000b" }).success,
    ).toBe(false);
    expect(
      ApprovalActionRequestSchema.safeParse({ action: "reject", feedback: "a\u0007" }).success,
    ).toBe(false);
    expect(
      ApprovalActionRequestSchema.safeParse({ action: "reject", feedback: "a\n\tb" }).success,
    ).toBe(true);
  });
});
