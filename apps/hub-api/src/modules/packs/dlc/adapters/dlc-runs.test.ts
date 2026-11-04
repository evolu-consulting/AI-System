// dlc-resume · tool `dlc-runs`: một dòng / lượt DLC, nói rõ khi run DỪNG chờ người quyết.
import { expect, test } from "bun:test";
import type { PackStepsView } from "../../kit/application/pack-runs.ports";
import { runLine } from "./dlc.tools";

const f = { id: "r1", mode: "bug-fix", project: "the-memories", ticketId: "t-1" };
const step = (idx: number, name: string, status: string) =>
  ({ idx, key: `s${idx}`, name, status }) as never;

test("needs_decision ⇒ lý do + bước dừng", () => {
  const v = {
    run_id: "r1",
    status: "needs_decision",
    started_by: "u",
    steps: [step(3, "Chuẩn bị đội", "passed"), step(4, "Build theo queue", "failed")],
    decision: { reason: "interrupted", at: null },
  } as PackStepsView;
  expect(runLine(f, v)).toBe(
    "- r1 [bug-fix, project the-memories, ticket t-1]: needs_decision, bước 5. Build theo queue (failed); DỪNG chờ người quyết, lý do: interrupted",
  );
});

test("không xem được ⇒ nói rõ", () => {
  expect(runLine({ ...f, ticketId: null }, null)).toBe(
    "- r1 [bug-fix, project the-memories]: không xem được",
  );
});
