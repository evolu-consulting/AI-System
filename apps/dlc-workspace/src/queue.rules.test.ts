import { describe, expect, test } from "bun:test";
import { enqueue, MAX_ATTEMPTS, next, result, summary } from "./queue.rules";

const T = "2026-10-30T00:00:00.000Z";
const twoItems = () =>
  enqueue(
    [],
    [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ],
    T,
  );

describe("dlc-dify · queue một project", () => {
  test("FIFO, một việc in_progress tại một thời điểm (tuần tự)", () => {
    let q = twoItems();
    const n1 = next(q, T);
    expect(n1.item?.id).toBe("a");
    expect(n1.item?.branch).toBe("task-a");
    q = n1.queue;
    expect(next(q, T).item?.id).toBe("a");
    q = result(q, "a", { ok: true, note: "ok" }, T).queue;
    expect(next(q, T).item?.id).toBe("b");
  });
  test("lỗi ⇒ về đầu queue cho dev agent làm lại; quá hạn ⇒ failed", () => {
    let q = twoItems();
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      q = next(q, T).queue;
      const r = result(q, "a", { ok: false, note: `fail ${i}` }, T);
      q = r.queue;
      expect(r.item?.status).toBe("queued");
      expect(q[0]?.id).toBe("a");
    }
    q = next(q, T).queue;
    q = result(q, "a", { ok: false, note: "last" }, T).queue;
    expect(q.find((x) => x.id === "a")?.status).toBe("failed");
    expect(next(q, T).item?.id).toBe("b");
  });
  test("id trùng không thêm lần hai; summary đếm đúng", () => {
    const q = enqueue(enqueue([], [{ id: "x", title: "X" }], T), [{ id: "x", title: "X" }], T);
    expect(q).toHaveLength(1);
    expect(summary(q)).toEqual({
      total: 1,
      queued: 1,
      in_progress: 0,
      ready_to_deploy: 0,
      failed: 0,
    });
  });
});
