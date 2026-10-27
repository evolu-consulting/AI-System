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
