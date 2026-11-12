// CR-118 · COM-FR-31 · RouterPort trên router mức thấp giả.
import { describe, expect, it } from "bun:test";
import { createRouterPort, type LowRouter } from "./router-port";

function fake(pathname: string, search = "") {
  const calls: { url: string; replace: boolean }[] = [];
  const subs = new Set<() => void>();
  const low: LowRouter = {
    location: () => ({ pathname, search }),
    navigate: (url, o) => calls.push({ url, replace: o.replace }),
    subscribe: (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
  return { low, calls, subs };
}

describe("createRouterPort", () => {
  it("read đọc URL hiện tại; go/replace ghi URL chuẩn /community/*", () => {
    const f = fake("/community/profile/abc/files", "");
    const p = createRouterPort(f.low);
    expect(p.read()).toEqual({
      route: { name: "profile", orgId: "abc", section: "files" },
    });
    p.go({ name: "feed" });
    p.replace({ name: "profile", orgId: "x" });
    expect(f.calls).toEqual([
      { url: "/community", replace: false },
      { url: "/community/profile/x", replace: true },
    ]);
    expect(p.href({ name: "profile" })).toBe("/community/profile");
  });
  it("subscribe trả hàm huỷ", () => {
    const f = fake("/community");
    const off = createRouterPort(f.low).subscribe(() => {});
    expect(f.subs.size).toBe(1);
    off();
    expect(f.subs.size).toBe(0);
  });
});
