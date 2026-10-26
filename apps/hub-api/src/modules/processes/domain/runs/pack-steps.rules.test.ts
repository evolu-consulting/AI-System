// contract-flow S1a · luật thuần trạng thái stage cho thẻ duyệt của gói (`stepsView`).
import { describe, expect, test } from "bun:test";
import { dueOf, stageMeta, stepStatusOf } from "./pack-steps.rules";

const open = { status: "open" as const, result: null };
const closed = (result: string) => ({ status: "closed" as const, result });

describe("S1a · stepStatusOf", () => {
  test.each([
    [{ stageStatus: "pending", round: 1, task: null }, "pending"],
    [{ stageStatus: "running", round: 1, task: null }, "pending"],
    [{ stageStatus: "waiting_review", round: 1, task: open }, "open"],
    [{ stageStatus: "done", round: 1, task: closed("pass") }, "passed"],
    [{ stageStatus: "done", round: 1, task: null }, "passed"],
    [{ stageStatus: "skipped", round: 1, task: null }, "skipped"],
    [{ stageStatus: "running", round: 2, task: closed("fail") }, "returned"],
    [{ stageStatus: "queued", round: 2, task: closed("pass") }, "returned"],
    [{ stageStatus: "pending", round: 1, task: closed("fail") }, "returned"],
    [{ stageStatus: "cancelled", round: 1, task: closed("reject") }, "rejected"],
    [{ stageStatus: "waiting_review", round: 2, task: open }, "open"],
    // cf-dify · stage tự chạy (bước Dify): đang chạy / lỗi hết lượt; xong vẫn `passed`; chưa tới ⇒ pending.
    [{ stageStatus: "running", round: 1, task: null, auto: true }, "running"],
    [{ stageStatus: "queued", round: 1, task: null, auto: true }, "running"],
    [{ stageStatus: "needs_decision", round: 1, task: null, auto: true }, "failed"],
    [{ stageStatus: "done", round: 1, task: null, auto: true }, "passed"],
    [{ stageStatus: "pending", round: 1, task: null, auto: true }, "pending"],
    [{ stageStatus: "needs_decision", round: 1, task: null }, "pending"],
  ] as const)("%o ⇒ %s", (f, want) => {
    expect(stepStatusOf(f)).toBe(want);
  });
});

describe("S1a · stageMeta / dueOf", () => {
  test("review ⇒ Group duyệt; auto ⇒ null; snapshot hỏng ⇒ khoá #i", () => {
    expect(
      stageMeta({ key: "s1", name: "Pháp chế", after: { kind: "review", group_id: "g" } }, 1),
    ).toEqual({
      key: "s1",
      name: "Pháp chế",
      groupId: "g",
    });
    expect(stageMeta({ key: "route", after: { kind: "auto" } }, 1)).toEqual({
      key: "route",
      name: "route",
      groupId: null,
    });
    expect(stageMeta(null, 2)).toEqual({ key: "#3", name: "#3", groupId: null });
  });
  test("dueOf: null ⇒ null; chuỗi/Date ⇒ ISO", () => {
    expect(dueOf(null)).toBeNull();
    expect(dueOf("2026-10-23T01:00:00Z")).toBe("2026-10-23T01:00:00.000Z");
    expect(dueOf(new Date("2026-10-23T01:00:00Z"))).toBe("2026-10-23T01:00:00.000Z");
  });
});
