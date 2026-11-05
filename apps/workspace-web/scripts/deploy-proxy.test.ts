// M1D-FR-02 · cấu hình proxy: contracts-web gọi /admin/* (admin-api) cùng origin — dev (rsbuild) và production (mẫu nginx trong
// docs/guides/deploy.md) phải cùng bảng route: /auth + /admin → admin-api; /pack, /notifications, /conversations, /runs → hub-api.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { proxy } from "../rsbuild.config";

const DEPLOY = readFileSync(join(import.meta.dir, "../../../docs/guides/deploy.md"), "utf8");
const block = DEPLOY.split("```nginx")
  .map((b) => b.split("```")[0] ?? "")
  .find((b) => b.includes("server_name contracts.example.com")) as string;
const upstream = (loc: string): string | undefined =>
  new RegExp(`location[^\\n]*${loc}[^\\n]*\\{[^}]*proxy_pass http://127\\.0\\.0\\.1:(\\d+)`).exec(
    block,
  )?.[1];

describe("proxy contracts-web (/admin → admin-api)", () => {
  test("dev (rsbuild): /admin cùng đích với /auth (admin-api), khác /pack (hub-api)", () => {
    // /notifications là object { target, bypass } (route SPA trả index.html khi mở trang) — so theo target.
    const p = proxy as Record<string, string | { target: string }>;
    const to = (k: string) => {
      const v = p[k];
      return typeof v === "string" ? v : v?.target;
    };
    expect(to("/admin")).toBe(to("/auth"));
    expect(to("/admin")).not.toBe(to("/pack"));
    for (const k of ["/pack", "/notifications", "/conversations", "/runs"])
      expect(to(k)).toBe(to("/pack"));
  });

  test("production: mẫu nginx trong deploy.md có vhost contracts-web; /admin, /auth → 3001; các route hub → 4000", () => {
    expect(block).toBeDefined();
    expect(upstream("\\^~ /admin/")).toBe("3001");
    expect(upstream("\\^~ /auth/")).toBe("3001");
    for (const r of ["pack", "conversations", "runs", "notifications"]) {
      expect(block).toMatch(new RegExp(`location ~ \\^/\\([^)]*\\b${r}\\b[^)]*\\)/`));
    }
    expect(upstream("\\(pack\\|")).toBe("4000");
    expect(block).toContain("try_files $uri /index.html");
  });
});

// CR-119 phần 2: nginx `web` (cổng 8081 của kit prod) — web SPA ở /contracts/* và /community/* PHẢI rơi vào `location /` (history fallback),
// không location API nào khớp; API hợp đồng ở /pack/contracts/* và /notifications (vừa API vừa route SPA cũ) đi tới hub.
describe("kit prod · nginx web 8081 không đụng /contracts/*", () => {
  const conf = readFileSync(
    join(import.meta.dir, "../../../deploy/prod-sohoptac2/nginx.conf"),
    "utf8",
  );
  const server = conf.slice(conf.indexOf("listen 8081;"), conf.indexOf("# --- admin-web"));
  const rules = [...server.matchAll(/^\s*location\s+(=\s+|~\s+)?(\S+)\s*\{/gm)].map((m) => ({
    kind: (m[1] ?? "").trim(),
    pat: m[2] as string,
  }));
  const hits = (path: string) =>
    rules.filter((r) =>
      r.kind === "="
        ? path === r.pat
        : r.kind === "~"
          ? new RegExp(r.pat).test(path)
          : r.pat !== "/" && path.startsWith(r.pat),
    );
  test("đường SPA không khớp location nào ngoài `location /`", () => {
    for (const p of [
      "/contracts",
      "/contracts/list",
      "/contracts/c/abc",
      "/contracts/partners",
      "/contracts/notifications",
      "/community",
      "/login",
    ])
      expect(hits(p).map((r) => r.pat)).toEqual([]);
  });
  test("API: /pack/contracts/* và /notifications* vào hub (location regex), trình duyệt GET /notifications html ⇒ index.html", () => {
    expect(hits("/pack/contracts/overview").length).toBeGreaterThan(0);
    expect(hits("/notifications").length).toBeGreaterThan(0);
    expect(server).toContain("rewrite ^ /index.html last");
  });
});
