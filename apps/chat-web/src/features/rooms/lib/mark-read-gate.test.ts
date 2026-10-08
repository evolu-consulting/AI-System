// HUB-FR-100 · cổng đánh dấu đã đọc: throttle 1 lần/giây, gộp trailing, bỏ seq cũ.
import { describe, expect, test } from "bun:test";
import { createMarkReadGate } from "./mark-read-gate";

function setup(fail = false) {
  let clock = 10_000;
  const sent: number[] = [];
  const timers: { at: number; cb: () => void }[] = [];
  const gate = createMarkReadGate({
    send: (s) => {
      sent.push(s);
      return fail ? Promise.reject(new Error("x")) : Promise.resolve();
    },
    now: () => clock,
    setTimer: (cb, ms) => {
      const t = { at: clock + ms, cb };
      timers.push(t);
      return () => timers.splice(timers.indexOf(t), 1);
    },
    intervalMs: 1000,
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const t of [...timers]) {
      if (t.at > clock) continue;
      timers.splice(timers.indexOf(t), 1);
      t.cb();
    }
  };
  return { gate, sent, advance, timers };
}

describe("createMarkReadGate", () => {
  test("lần đầu gửi ngay; seq không mới hơn bị bỏ", () => {
    const { gate, sent } = setup();
    gate.offer(5);
    gate.offer(5);
    gate.offer(3);
    expect(sent).toEqual([5]);
  });

  test("trong 1 giây gộp thành một lần trailing với seq lớn nhất", () => {
    const { gate, sent, advance } = setup();
    gate.offer(1);
    gate.offer(2);
    gate.offer(4);
    expect(sent).toEqual([1]);
    advance(999);
    expect(sent).toEqual([1]);
    advance(1);
    expect(sent).toEqual([1, 4]);
  });

  test("sau khoảng nghỉ gửi ngay", () => {
    const { gate, sent, advance } = setup();
    gate.offer(1);
    advance(1500);
    gate.offer(2);
    expect(sent).toEqual([1, 2]);
  });

  test("dispose huỷ lần trailing", () => {
    const { gate, sent, advance, timers } = setup();
    gate.offer(1);
    gate.offer(2);
    gate.dispose();
    advance(2000);
    expect(sent).toEqual([1]);
    expect(timers.length).toBe(0);
  });

  test("gửi lỗi: offer cùng seq được thử lại", async () => {
    const { gate, sent, advance } = setup(true);
    gate.offer(3);
    await Promise.resolve();
    await Promise.resolve();
    advance(1000);
    gate.offer(3);
    expect(sent).toEqual([3, 3]);
  });
});

describe("createMarkReadGate · lỗi", () => {
  test("RV1 #9: POST lỗi ⇒ tự thử lại đúng seq một lần sau intervalMs, không lặp vô hạn", async () => {
    const { gate, sent, advance } = setup(true);
    gate.offer(5);
    await Promise.resolve();
    await Promise.resolve();
    advance(1000);
    expect(sent).toEqual([5, 5]);
    await Promise.resolve();
    await Promise.resolve();
    advance(5000);
    expect(sent).toEqual([5, 5]);
  });

  test("RV2 N3: lỗi về sau dispose ⇒ không hẹn thử lại, offer bị bỏ", async () => {
    const { gate, sent, timers, advance } = setup(true);
    gate.offer(5);
    gate.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(timers).toHaveLength(0);
    advance(5000);
    gate.offer(9);
    expect(sent).toEqual([5]);
  });
});
