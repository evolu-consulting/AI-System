// CR-122 · E3b · luật lưu def `wait_event.branches` (WAIT_INVALID) + field output `event` của node Chờ sự kiện.
import { describe, expect, it } from "bun:test";
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import { ensureWaitEventStage } from "../wait-event/node";
import { timedWaitDefIssues } from "./wait-timed.rules";

const stage = (step: number, executor: object) =>
  ({
    key: `s${step}`,
    step,
    real_action: false,
    after: { kind: "auto" },
    executor,
    output: { fields: [] },
  }) as unknown as ProcessDefInput["stages"][number];
const wait = (branches: object[]) => ({
  kind: "wait_event",
  event: "esign.completed",
  timeout_h: 24,
  also_events: ["esign.declined"],
  branches,
});
const def = (branches: object[]) =>
  ({
    stages: [
      stage(0, { kind: "agent" }),
      stage(1, wait(branches)),
      stage(2, { kind: "set" }),
      stage(3, { kind: "set" }),
    ],
  }) as unknown as ProcessDefInput;

describe("CR-122 E3b · wait_event.branches", () => {
  it("on ∈ khoá chờ/timeout + đích bước sau có thật ⇒ hợp lệ", () => {
    expect(
      timedWaitDefIssues(
        def([
          { on: "esign.declined", goto_step: 3 },
          { on: "timeout", goto_step: 3 },
        ]),
      ),
    ).toEqual([]);
  });
  it("on lạ / đích lùi / đích không có ⇒ WAIT_INVALID đúng đường dẫn", () => {
    expect(
      timedWaitDefIssues(
        def([
          { on: "esign.other", goto_step: 3 },
          { on: "esign.declined", goto_step: 1 },
          { on: "timeout", goto_step: 9 },
        ]),
      ).map((x) => x.path),
    ).toEqual([
      "stages.1.executor.branches.0",
      "stages.1.executor.branches.1",
      "stages.1.executor.branches.2",
    ]);
  });
  it("normalize khai field output `event`", () => {
    const s = ensureWaitEventStage(stage(1, wait([])) as never) as { output: { fields: unknown } };
    expect(s.output.fields).toEqual([{ key: "event", type: "string", required: false }]);
  });
});
