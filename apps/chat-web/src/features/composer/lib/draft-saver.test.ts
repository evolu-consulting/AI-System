import { expect, test } from "bun:test";
import { createDraftSaver } from "./draft-saver";

function setup(authed: boolean) {
  const state = { authed, store: new Map<string, string>(), timers: [] as (() => void)[] };
  const saver = createDraftSaver("chat:draft:u1:c:f", 300, {
    write: (k, v) => void state.store.set(k, v),
    remove: (k) => void state.store.delete(k),
    canWrite: () => state.authed,
    setTimer: (cb) => state.timers.push(cb),
    clearTimer: () => {},
  });
  return { state, saver };
}

test("flush ghi nháp khi còn đăng nhập; nháp rỗng thì xoá khoá", () => {
  const { state, saver } = setup(true);
  saver.save("abc");
  saver.flush();
  expect(state.store.get("chat:draft:u1:c:f")).toBe("abc");
  saver.save("");
  saver.flush();
  expect(state.store.size).toBe(0);
});

test("review C1 m1 · đăng xuất trong lúc debounce → flush (cleanup/timer) không ghi lại nháp", () => {
  const { state, saver } = setup(true);
  saver.save("dang gõ");
  state.authed = false;
  saver.flush();
  state.timers[0]?.();
  expect(state.store.size).toBe(0);
});
