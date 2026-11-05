// CR-118 · cr118-feature-gate-web · nguồn `/pack/me`: 304 không báo, refetch khi sự kiện/nối lại/focus, 403, provider OpenFeature.
import { describe, expect, test } from "bun:test";
import type { ShellMeResponse } from "@ai/contracts/capabilities";
import { ErrorCode, ProviderEvents } from "@openfeature/web-sdk";
import {
  createPackMeSource,
  FOCUS_THROTTLE_MS,
  type FocusTarget,
  type PackMeFetch,
  type PackMeResult,
} from "./pack-me-source";
import { createPackMeProvider } from "./provider";

const me = (flags: Record<string, boolean>): ShellMeResponse =>
  ({
    versions: { admin: 1, hub: 1 },
    user: { id: "u", tenant_id: "t", role: "member", kind: "internal" },
    packs: {},
    addons: [],
    flags,
    brand: null,
    home: null,
    apps: ["contracts"],
  }) as ShellMeResponse;

function rig(results: (PackMeResult | Error)[]) {
  const etags: (string | null)[] = [];
  let i = 0;
  const fetch: PackMeFetch = async (etag) => {
    etags.push(etag);
    const r = results[Math.min(i++, results.length - 1)] as PackMeResult | Error;
    if (r instanceof Error) throw r;
    return r;
  };
  let changed = () => {};
  let reconnected = () => {};
  const focusFns = new Set<() => void>();
  const focus: FocusTarget = {
    addEventListener: (_t, fn) => void focusFns.add(fn),
    removeEventListener: (_t, fn) => void focusFns.delete(fn),
  };
  let clock = 0;
  const source = createPackMeSource({
    fetch,
    listen: async (_s, c, r) => {
      changed = c;
      reconnected = r;
    },
    focus,
    now: () => clock,
  });
  return {
    source,
    etags,
    fire: () => changed(),
    reconnect: () => reconnected(),
    focus: () => {
      for (const f of focusFns) f();
    },
    tick: (ms: number) => {
      clock += ms;
    },
    calls: () => i,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const fresh = (flags: Record<string, boolean>, etag: string): PackMeResult => ({
  status: "fresh",
  data: me(flags),
  etag,
});

describe("PackMeSource (CR-118 N2/N3)", () => {
  test("ETag gửi lại sau lần đầu và 304 giữ ảnh không báo", async () => {
    const r = rig([fresh({ contracts: true }, '"a1"'), { status: "not-modified" }]);
    const seen: unknown[] = [];
    r.source.subscribe((d) => seen.push(d));
    await r.source.refresh();
    await r.source.refresh();
    expect(r.etags).toEqual([null, '"a1"']);
    expect(r.source.snapshot()?.flags).toEqual({ contracts: true });
    expect(seen).toHaveLength(1);
  });

  test("config.changed tải lại và báo khi ảnh đổi, nối lại sau đứt cũng tải", async () => {
    const r = rig([
      fresh({ contracts: true }, '"a1"'),
      fresh({ contracts: false }, '"a2"'),
      { status: "not-modified" },
    ]);
    const seen: boolean[] = [];
    r.source.subscribe((d) => seen.push(d.flags.contracts ?? false));
    r.source.start();
    await r.source.refresh();
    r.fire();
    await flush();
    expect(r.source.snapshot()?.flags.contracts).toBe(false);
    r.reconnect();
    await flush();
    expect(r.calls()).toBe(3);
    expect(seen).toEqual([true, false]);
  });

  test("focus tải lại có throttle, stop gỡ listener và xoá ảnh", async () => {
    const r = rig([fresh({ contracts: true }, '"a1"'), { status: "not-modified" }]);
    r.source.start();
    r.focus();
    await flush();
    r.focus();
    await flush();
    expect(r.calls()).toBe(1);
    r.tick(FOCUS_THROTTLE_MS);
    r.focus();
    await flush();
    expect(r.calls()).toBe(2);
    r.source.stop();
    r.focus();
    await flush();
    expect(r.calls()).toBe(2);
    expect(r.source.snapshot()).toBeNull();
  });

  test("403 từ API khác gọi reportForbidden thì tải lại và nuốt lỗi", async () => {
    const r = rig([fresh({ contracts: true }, '"a1"'), new Error("boom")]);
    await r.source.refresh();
    r.source.reportForbidden();
    await flush();
    expect(r.calls()).toBe(2);
    expect(r.source.snapshot()?.flags.contracts).toBe(true);
  });

  test("các lời gọi đồng thời gộp thành một request", async () => {
    const r = rig([fresh({ a: true }, '"a1"')]);
    await Promise.all([r.source.refresh(), r.source.refresh(), r.source.ensure()]);
    expect(r.calls()).toBe(1);
  });
});

describe("provider OpenFeature", () => {
  test("chưa có ảnh dùng mặc định, có ảnh mà thiếu khoá thì tắt", async () => {
    const r = rig([fresh({ contracts: true, "contracts.write": false }, '"a1"')]);
    const p = createPackMeProvider(r.source);
    expect(p.resolveBooleanEvaluation?.("contracts", true, {}, console as never).value).toBe(true);
    await r.source.refresh();
    const ev = (k: string) => p.resolveBooleanEvaluation?.(k, true, {}, console as never).value;
    expect(ev("contracts")).toBe(true);
    expect(ev("contracts.write")).toBe(false);
    expect(ev("community")).toBe(false);
    expect(p.resolveStringEvaluation?.("x", "d", {}, console as never).errorCode).toBe(
      ErrorCode.TYPE_MISMATCH,
    );
  });

  test("ảnh đổi ⇒ phát ConfigurationChanged", async () => {
    const r = rig([fresh({ contracts: true }, '"a1"')]);
    const p = createPackMeProvider(r.source);
    let n = 0;
    p.events?.addHandler(ProviderEvents.ConfigurationChanged, () => void n++);
    await r.source.refresh();
    expect(n).toBe(1);
  });
});
