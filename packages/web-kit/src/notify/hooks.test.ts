// gap-c #13 · gộp trang theo con trỏ, bỏ trùng id; bản sao service worker ở 4 web phải giống hệt nhau.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { mergePage } from "./hooks";

const n = (id: string) => ({
  id,
  seq: 1,
  source: "s",
  kind: "k",
  title: id,
  body: "",
  link: null,
  created_at: "2026-10-21T00:00:00.000Z",
  read: false,
});

describe("notify hooks", () => {
  it("mergePage: nối trang sau, bỏ trùng id, giữ thứ tự", () => {
    expect(mergePage([n("a"), n("b")], [n("b"), n("c")]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("push-sw.js giống hệt ở contracts/admin/chat/studio", () => {
    const f = (a: string) =>
      readFileSync(new URL(`../../../../apps/${a}/public/push-sw.js`, import.meta.url), "utf8");
    const base = f("contracts-web");
    expect(base).toContain("showNotification");
    for (const a of ["admin-web", "chat-web", "studio-web"]) expect(f(a)).toBe(base);
  });
});
