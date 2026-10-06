// HUB-FR-72 · H4a-AC-11 · plan P12, §5.4 · R-K5 · test-plan H4a §3 A67–A74: Hub phục vụ bản build Studio ở `/studio` từ
// `studioDist` (cùng origin), SPA fallback cho đường dẫn không đuôi, 404 JSON cho file có đuôi không tồn tại, header bảo
// mật, chặn `..`; `/studio/api/*` không bao giờ rơi vào fallback; không cấu hình dist ⇒ `/studio` 404 JSON.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call, type Res } from "../H1/_fixtures";
import type { HubX } from "../H1/_hub";
import { startHubH2b } from "../H2b/_h2b";
import { type Ctx, errOf, STUDIO_DIST, startH4a, tok } from "./_h4a";

let x: Ctx;
let bare: HubX;
beforeAll(async () => {
  x = await startH4a({ instanceId: "qc-hub-h4a-static", studioDist: STUDIO_DIST });
  bare = await startHubH2b(x.k, { instanceId: "qc-hub-h4a-nodist" } as never);
}, 60_000);
afterAll(async () => {
  await bare?.stop();
  await x?.stop();
});

const get = (path: string, hub: HubX = x.hub, token?: string): Promise<Res> =>
  call(hub, "GET", path, { token });
async function raw(path: string, hub: HubX = x.hub): Promise<Response> {
  return fetch(`${hub.base}${path}`, { redirect: "manual" });
}
const isIndex = (r: Res) => r.status === 200 && r.text.includes("QC-H4A-STUDIO-INDEX");

describe("A67–A74 · phục vụ tĩnh `/studio` [HUB-FR-72 · H4a-AC-11]", () => {
  it("HUB-FR-72 · A67 · GET /studio ⇒ 308 tới /studio/; GET /studio/ ⇒ 200 index.html (text/html, no-cache) [H4a-AC-11 · plan §5.4]", async () => {
    const r = await raw("/studio");
    expect(r.status).toBe(308);
    expect(r.headers.get("location")).toMatch(/\/studio\/$/);
    const i = await get("/studio/");
    expect(isIndex(i)).toBe(true);
    expect(i.headers.get("content-type") ?? "").toContain("text/html");
    expect(i.headers.get("cache-control") ?? "").toContain("no-cache");
  });

  it("HUB-FR-72 · A68 · reload sâu /studio/agents/x và /studio/orchestrator?tenant=new ⇒ 200 index.html (SPA fallback) [H4a-AC-11]", async () => {
    for (const p of [
      "/studio/agents/x",
      "/studio/agents/new",
      "/studio/orchestrator?tenant=new",
      "/studio/login",
    ])
      expect([p, isIndex(await get(p))]).toEqual([p, true]);
  });

  it("HUB-FR-72 · A69 · /studio/static/js/app.js ⇒ 200 JS, Cache-Control immutable 1 năm [plan §5.4]", async () => {
    const r = await get("/studio/static/js/app.js");
    expect(r.status).toBe(200);
    expect(r.text).toContain("QC-H4A-STUDIO-JS");
    expect(r.headers.get("cache-control") ?? "").toContain("max-age=31536000");
    expect(r.headers.get("cache-control") ?? "").toContain("immutable");
  });

  it("HUB-FR-72 · A70 · file có đuôi không tồn tại ⇒ 404 JSON (không index.html) [plan §3]", async () => {
    const r = await get("/studio/static/js/khong-co.js");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type") ?? "").toContain("application/json");
    expect(r.text).not.toContain("QC-H4A-STUDIO-INDEX");
  });

  it("HUB-FR-72 · A71 · header bảo mật mọi phản hồi tĩnh: nosniff, X-Frame-Options DENY, Referrer-Policy no-referrer [plan §5.4]", async () => {
    for (const p of ["/studio/", "/studio/agents/x", "/studio/static/js/app.js"]) {
      const r = await get(p);
      expect([
        p,
        r.headers.get("x-content-type-options"),
        r.headers.get("x-frame-options"),
        r.headers.get("referrer-policy"),
      ]).toEqual([p, "nosniff", "DENY", "no-referrer"]);
    }
  });

  it("HUB-FR-72 · A72 · đường dẫn chứa `..`/`%2e%2e` ⇒ 404, không lộ file ngoài dist [plan §5.4]", async () => {
    for (const p of [
      "/studio/..%2f..%2fpackage.json",
      "/studio/%2e%2e/%2e%2e/package.json",
      "/studio/static/%2e%2e/%2e%2e/index.html.bak",
    ]) {
      const r = await get(p);
      expect([p, r.status]).toEqual([p, 404]);
      expect(r.text).not.toContain('"workspaces"');
    }
  });

  it("HUB-FR-72 · A73 · /studio/api/* không rơi vào fallback: không token ⇒ 401 JSON; padmin path lạ ⇒ 404 JSON [R-K5 · plan P12]", async () => {
    const a = await get("/studio/api/agents");
    expect(errOf(a)).toMatchObject({ status: 401, code: "AUTH_EXPIRED" });
    expect(a.text).not.toContain("QC-H4A-STUDIO-INDEX");
    const b = await get("/studio/api/khong-co", x.hub, await tok(x.k, "padmin"));
    expect(b.status).toBe(404);
    expect(b.headers.get("content-type") ?? "").toContain("application/json");
    expect(b.text).not.toContain("QC-H4A-STUDIO-INDEX");
  });

  it("HUB-FR-72 · A74 · Hub không cấu hình dist ⇒ /studio/ và /studio/agents 404 JSON; /studio/api vẫn 401 [H4a-AC-11 · spec §7]", async () => {
    for (const p of ["/studio/", "/studio/agents"]) {
      const r = await get(p, bare);
      expect([
        p,
        r.status,
        (r.headers.get("content-type") ?? "").includes("application/json"),
      ]).toEqual([p, 404, true]);
    }
    expect(errOf(await get("/studio/api/me", bare)).code).toBe("AUTH_EXPIRED");
  });
});
