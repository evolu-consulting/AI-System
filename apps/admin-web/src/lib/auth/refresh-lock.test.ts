import { describe, expect, test } from "bun:test";
import type { Me } from "@ai/contracts";
import { ApiError } from "./http";
import {
  createRefresher,
  type LockManagerLike,
  type RefresherDeps,
  type RefreshResult,
} from "./refresh-lock";

const me = { username: "lan.tran" } as unknown as Me;

/** Khoá giả lập liên tab: các `request` chạy tuần tự. */
function fakeLocks(): LockManagerLike {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, cb: () => Promise<T>): Promise<T> {
      const run = tail.then(cb, cb);
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

function setup(over: Partial<RefresherDeps> = {}) {
  let calls = 0;
  let clock = 1_000;
  const sent: Array<{ token: string; at: number }> = [];
  const deps: RefresherDeps = {
    callRefresh: async (): Promise<RefreshResult> => {
      calls += 1;
      return { accessToken: `tok-${calls}`, me };
    },
    locks: null,
    broadcast: (token, at) => sent.push({ token, at }),
    now: () => clock,
    sleep: async () => {},
    ...over,
  };
  return { deps, calls: () => calls, sent, tick: (ms: number) => (clock += ms) };
}

describe("ADM-FR-02 · refresh single-flight + Web Locks", () => {
  test("5 request đồng thời → 1 lần gọi API", async () => {
    const s = setup();
    const r = createRefresher(s.deps);
    const out = await Promise.all(
      Array.from({ length: 5 }, () => r.refresh({ stale: "old", allowShared: true })),
    );
    expect(s.calls()).toBe(1);
    expect(new Set(out.map((x) => x.accessToken)).size).toBe(1);
    expect(s.sent).toHaveLength(1);
  });

  test("hai tab tuần tự qua khoá → 1 refresh thật, tab sau dùng token broadcast", async () => {
    const locks = fakeLocks();
    let calls = 0;
    const call = async (): Promise<RefreshResult> => {
      calls += 1;
      return { accessToken: `tok-${calls}`, me };
    };
    let tabB: ReturnType<typeof createRefresher> | undefined;
    const tabA = createRefresher({
      callRefresh: call,
      locks,
      broadcast: (token, at) => tabB?.receive(token, at),
      now: () => 5_000,
      sleep: async () => {},
    });
    tabB = createRefresher({
      callRefresh: call,
      locks,
      broadcast: (token, at) => tabA.receive(token, at),
      now: () => 5_000,
      sleep: async () => {},
    });
    const [a, b] = await Promise.all([
      tabA.refresh({ stale: "old", allowShared: true }),
      tabB.refresh({ stale: "old", allowShared: true }),
    ]);
    expect(calls).toBe(1);
    expect(a.accessToken).toBe("tok-1");
    expect(b.accessToken).toBe("tok-1");
  });

  test("token broadcast quá 10 giây hoặc trùng token đã bị 401 → gọi API", async () => {
    const s = setup();
    const r = createRefresher(s.deps);
    r.receive("shared", 1_000);
    s.tick(11_000);
    const out = await r.refresh({ stale: "old", allowShared: true });
    expect(out.accessToken).toBe("tok-1");
    r.receive("tok-1", s.deps.now());
    const again = await r.refresh({ stale: "tok-1", allowShared: true });
    expect(again.accessToken).toBe("tok-2");
  });

  test("allowShared=false (khởi động) luôn gọi API để lấy `me`", async () => {
    const s = setup();
    const r = createRefresher(s.deps);
    r.receive("shared", s.deps.now());
    const out = await r.refresh({ stale: null, allowShared: false });
    expect(s.calls()).toBe(1);
    expect(out.me).toBe(me);
  });

  test("không có navigator.locks → vẫn 1 lần mỗi tab", async () => {
    const s = setup({ locks: null });
    const r = createRefresher(s.deps);
    await Promise.all([
      r.refresh({ stale: "a", allowShared: true }),
      r.refresh({ stale: "a", allowShared: true }),
    ]);
    expect(s.calls()).toBe(1);
  });

  test("REFRESH_SUPERSEDED → thử lại đúng 1 lần", async () => {
    let n = 0;
    const s = setup({
      callRefresh: async () => {
        n += 1;
        if (n === 1) throw new ApiError(401, "REFRESH_SUPERSEDED", "superseded");
        return { accessToken: "after-retry", me };
      },
    });
    const out = await createRefresher(s.deps).refresh({ stale: "x", allowShared: true });
    expect(n).toBe(2);
    expect(out.accessToken).toBe("after-retry");
  });

  test("REFRESH_SUPERSEDED lần 2 vẫn lỗi → ném lỗi; INVALID_REFRESH_TOKEN không thử lại", async () => {
    let n = 0;
    const superseded = setup({
      callRefresh: async () => {
        n += 1;
        throw new ApiError(401, "REFRESH_SUPERSEDED", "superseded");
      },
    });
    await expect(
      createRefresher(superseded.deps).refresh({ stale: "x", allowShared: true }),
    ).rejects.toMatchObject({ code: "REFRESH_SUPERSEDED" });
    expect(n).toBe(2);

    let m = 0;
    const invalid = setup({
      callRefresh: async () => {
        m += 1;
        throw new ApiError(401, "INVALID_REFRESH_TOKEN", "invalid");
      },
    });
    await expect(
      createRefresher(invalid.deps).refresh({ stale: "x", allowShared: true }),
    ).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });
    expect(m).toBe(1);
  });

  test("sau khi xong, lần refresh kế gọi lại API (không kẹt inflight)", async () => {
    const s = setup();
    const r = createRefresher(s.deps);
    await r.refresh({ stale: "a", allowShared: false });
    await r.refresh({ stale: "b", allowShared: false });
    expect(s.calls()).toBe(2);
  });
});
