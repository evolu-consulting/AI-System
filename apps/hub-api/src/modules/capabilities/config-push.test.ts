// CR-118 N3 · ảnh cấu hình đổi ⇒ `config.changed` tới phiên `/me/stream` của tenant bị chạm (gộp trong một microtask).
import { describe, expect, it } from "bun:test";
import type { ConfigChange } from "../config/config.service";
import { MeStreamConns } from "../me-stream/me-stream.session";
import { configChangedFrame, startConfigPush } from "./config-push";

function src() {
  const fns = new Set<(c: ConfigChange) => void>();
  return {
    onChange(fn: (c: ConfigChange) => void) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    fire(c: ConfigChange) {
      for (const f of fns) f(c);
    },
    size: () => fns.size,
  };
}
const sess = (tenantId: string, got: string[]) => ({
  end() {},
  tenantId,
  notify: (f: string) => got.push(f),
});
const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("CR-118 N3 · config push", () => {
  it("frame SSE đúng dạng (không id)", () => {
    expect(configChangedFrame({ admin: 4, hub: 9 })).toBe(
      'event: config.changed\ndata: {"admin":4,"hub":9}\n\n',
    );
  });
  it("chỉ tenant bị chạm nhận; null ⇒ mọi tenant; nhiều lần đổi cùng lượt gộp một frame (version cuối)", async () => {
    const s = src();
    const conns = new MeStreamConns();
    const a: string[] = [];
    const b: string[] = [];
    conns.add("u1", sess("A", a));
    conns.add("u2", sess("B", b));
    conns.add("u3", { end() {} }); // phiên giả không notify ⇒ bỏ qua
    startConfigPush(s, conns);
    s.fire({ admin: 2, hub: 1, tenants: new Set(["A"]) });
    s.fire({ admin: 3, hub: 1, tenants: new Set(["A"]) });
    await tick();
    expect(a).toEqual([configChangedFrame({ admin: 3, hub: 1 })]);
    expect(b).toEqual([]);
    s.fire({ admin: 3, hub: 2, tenants: null });
    await tick();
    expect(a.length).toBe(2);
    expect(b).toEqual([configChangedFrame({ admin: 3, hub: 2 })]);
  });
  it("broadcast bị chặn bởi `max`; abort ⇒ huỷ nghe", () => {
    const conns = new MeStreamConns();
    const got: string[] = [];
    for (let i = 0; i < 5; i++) conns.add(`u${i}`, sess("A", got));
    expect(conns.broadcast("x", null, 3)).toBe(3);
    const s = src();
    const ac = new AbortController();
    startConfigPush(s, conns, ac.signal);
    expect(s.size()).toBe(1);
    ac.abort();
    expect(s.size()).toBe(0);
  });
});
