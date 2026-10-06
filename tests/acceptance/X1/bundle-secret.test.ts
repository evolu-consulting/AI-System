// X1-AC11 · ADM-FR-23 · reviewer Blocker · `HUB_INTERNAL_TOKEN` chỉ ở server admin-api: build admin-web với token đặt trong
// env (giá trị sinh LÚC CHẠY) ⇒ `apps/admin-web/dist` không chứa giá trị token (thô/base64/hex) và không chứa tên biến.
// Tự build (không dựa vào dist có sẵn — dist cũ không biết token). Là test chặn hồi quy: xanh từ trước khi có code,
// đỏ khi ai đó đưa token vào bundle (vd tiền tố PUBLIC_ hoặc define).
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_modules";

const DIST = join(ROOT, "apps/admin-web/dist");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

const label = (x: string, token: string): string =>
  x === token ? "token" : x === "HUB_INTERNAL_TOKEN" ? "tên biến" : "token mã hoá";

function buildEnv(token: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, {
    HUB_INTERNAL_TOKEN: token,
    ADMIN_HUB_URL: "http://localhost:4000",
    PUBLIC_HUB_URL: "http://localhost:4000",
    PUBLIC_STUDIO_URL: "http://localhost:3200/studio/",
  });
  delete env.NODE_ENV; // `bun test` đặt NODE_ENV=test ⇒ build rsbuild hỏng
  return env;
}

function scan(forms: string[], token: string): string[] {
  const hits: string[] = [];
  for (const f of files(DIST)) {
    const s = readFileSync(f, "latin1");
    for (const x of forms)
      if (s.includes(x)) hits.push(`${f.slice(ROOT.length)}: ${label(x, token)}`);
  }
  return hits;
}

describe("X1-AC11 · bundle admin-web không chứa HUB_INTERNAL_TOKEN", () => {
  it("X1-AC11 · build với HUB_INTERNAL_TOKEN (48 ký tự sinh lúc chạy) ⇒ dist không chứa giá trị (thô/base64/hex) lẫn tên biến", () => {
    const token = randomBytes(36).toString("base64url");
    const env = buildEnv(token);
    const b = Bun.spawnSync(["bun", "run", "--filter", "@ai/admin-web", "build"], {
      cwd: ROOT,
      env,
    });
    if (b.exitCode !== 0) throw new Error(b.stderr.toString().slice(-2000));
    const forms = [
      token,
      Buffer.from(token).toString("base64"),
      Buffer.from(token).toString("hex"),
      "HUB_INTERNAL_TOKEN",
    ];
    const hits = scan(forms, token);
    expect(hits).toEqual([]);
  }, 300_000);
});
