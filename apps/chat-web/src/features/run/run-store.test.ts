// review C1 #4 · store run: run đã kết thúc không tích luỹ vô hạn khi view không bao giờ thấy `answerId`.
import { expect, test } from "bun:test";
import { createRunState, type RunPhase, type RunState } from "./lib/reducer";
import { createRunStore, MAX_SETTLED_RUNS, pruneSettled } from "./run-store";

const run = (key: string, phase: RunPhase): RunState => ({
  ...createRunState({ key, convId: "c", origin: "main", request: { content: "x" } }),
  phase,
});

test("pruneSettled giữ run đang chạy + `max` run đã kết thúc mới nhất, giữ thứ tự", () => {
  const runs = [
    run("a", "finished"),
    run("b", "streaming"),
    run("c", "failed"),
    run("d", "lost"),
    run("e", "cancelled"),
  ];
  expect(pruneSettled(runs, 2).map((r) => r.key)).toEqual(["b", "c", "d", "e"]);
  expect(pruneSettled(runs, 3)).toBe(runs);
});

test("add vượt trần → bỏ run đã kết thúc cũ nhất; run đang chạy không bị bỏ", () => {
  const store = createRunStore();
  store.add(run("live", "streaming"));
  for (let i = 0; i <= MAX_SETTLED_RUNS; i++) store.add(run(`done-${i}`, "finished"));
  const keys = store.getRuns().map((r) => r.key);
  expect(keys).toHaveLength(MAX_SETTLED_RUNS + 1);
  expect(keys[0]).toBe("live");
  expect(keys).not.toContain("done-0");
  expect(keys).toContain(`done-${MAX_SETTLED_RUNS}`);
});
