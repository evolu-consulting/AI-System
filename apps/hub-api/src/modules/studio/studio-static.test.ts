// HUB-FR-72 · H4a-AC-11 · unit B3: `studio-static` trên dist tạm (308, SPA fallback, 404 JSON có đuôi, cache, header, `..`).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import {
  hasExtension,
  isStudioApiPath,
  isStudioDist,
  isTraversal,
  mountStudioStatic,
} from "./studio-static";

let dist: string;
const app = new Hono();
beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "studio-dist-"));
  mkdirSync(join(dist, "static", "js"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html>UNIT-INDEX</html>");
  writeFileSync(join(dist, "static", "js", "a.js"), "UNIT-JS");
  app.get("/studio/api/me", (c) => c.json({ ok: true }));
  mountStudioStatic(app, dist);
  app.notFound((c) => c.json({ code: "NOT_FOUND" }, 404));
});
afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe("H4a B3 · hàm thuần studio-static", () => {
  test("HUB-FR-72 · isStudioApiPath / hasExtension / isTraversal / isStudioDist", () => {
    expect([
      isStudioApiPath("/studio/api"),
      isStudioApiPath("/studio/api/x"),
      isStudioApiPath("/studio/apix"),
    ]).toEqual([true, true, false]);
    expect([
      hasExtension("/studio/a/b.js"),
      hasExtension("/studio/agents/x"),
      hasExtension("/studio/"),
    ]).toEqual([true, false, false]);
    expect([
      isTraversal("/studio/../x"),
      isTraversal("/studio/%2E%2E/x"),
      isTraversal("/studio/a.b"),
    ]).toEqual([true, true, false]);
    expect([isStudioDist(undefined), isStudioDist(join(tmpdir(), "khong-co-xyz"))]).toEqual([
      false,
      false,
    ]);
  });
});

describe("H4a B3 · mountStudioStatic", () => {
  test("HUB-FR-72 · /studio ⇒ 308 /studio/; /studio/ ⇒ index no-cache + header bảo mật", async () => {
    const r = await app.request("/studio");
    expect([r.status, r.headers.get("location")]).toEqual([308, "/studio/"]);
    const i = await app.request("/studio/");
    expect(await i.text()).toContain("UNIT-INDEX");
    expect(i.headers.get("cache-control")).toBe("no-cache");
    expect(i.headers.get("x-frame-options")).toBe("DENY");
  });
  test("HUB-FR-72 · đường sâu không đuôi ⇒ index (text/html); có đuôi không có ⇒ 404 JSON", async () => {
    const d = await app.request("/studio/agents/x");
    expect([d.status, d.headers.get("content-type")]).toEqual([200, "text/html; charset=utf-8"]);
    expect(await d.text()).toContain("UNIT-INDEX");
    const m = await app.request("/studio/static/js/khong.js");
    expect([m.status, ((await m.json()) as { error: { code: string } }).error.code]).toEqual([
      404,
      "NOT_FOUND",
    ]);
  });
  test("HUB-FR-72 · /studio/static/* ⇒ immutable; `..` ⇒ 404", async () => {
    const s = await app.request("/studio/static/js/a.js");
    expect(await s.text()).toBe("UNIT-JS");
    expect(s.headers.get("cache-control")).toContain("immutable");
    expect((await app.request("/studio/..%2f..%2fpackage.json")).status).toBe(404);
  });
  test("HUB-FR-72 · /studio/api/* không rơi vào fallback", async () => {
    expect(await (await app.request("/studio/api/me")).json()).toEqual({ ok: true });
    const n = await app.request("/studio/api/khong-co");
    expect([n.status, await n.json()]).toEqual([404, { code: "NOT_FOUND" }]);
  });
});
