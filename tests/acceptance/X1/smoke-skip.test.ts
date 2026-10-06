// X1-AC20 · X1-R02 · smoke Dify thật (`tests/smoke/X1/dify-live.ts`, test-plan §6): vắng `DIFY_LIVE=1` ⇒ exit 0, in
// "bỏ qua", 0 kết nối mạng (URL trỏ cổng đóng mà không lỗi). Kiểm tĩnh: không vòng retry, không console API,
// không /parameters /info, bộ đếm 1 lần/app, tuần tự (không Promise.all).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { ROOT } from "./_modules";

const SCRIPT = join(ROOT, "tests/smoke/X1/dify-live.ts");

/** Cổng TCP đang đóng (mở rồi đóng ngay). */
async function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const p = typeof a === "object" && a ? a.port : 1;
      s.close(() => resolve(p));
    });
  });
}

describe("X1-AC20 · smoke Dify thật", () => {
  it("X1-AC20 · vắng DIFY_LIVE ⇒ exit 0, in 'bỏ qua (vắng DIFY_LIVE=1)', không kết nối (URL cổng đóng vẫn exit 0)", async () => {
    const port = await closedPort();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && !k.startsWith("DIFY_") && !k.startsWith("SMOKE_")) env[k] = v;
    env.SMOKE_HUB_URL = `http://127.0.0.1:${port}`;
    env.SMOKE_AUTH_URL = `http://127.0.0.1:${port}`;
    env.SMOKE_PASSWORD = "khong-dung";
    const p = Bun.spawnSync(["bun", SCRIPT, "--apps", "translate"], { cwd: ROOT, env });
    const out = `${p.stdout.toString()}${p.stderr.toString()}`;
    expect(out).toContain("bỏ qua (vắng DIFY_LIVE=1)");
    expect(p.exitCode).toBe(0);
  });

  it("X1-AC20 · kiểm tĩnh script: không retry, không console API, không /parameters /info, đếm 1 lần/app, tuần tự", () => {
    const s = readFileSync(SCRIPT, "utf8");
    expect(s).not.toMatch(/retry\s*\(|retries\s*[:=]|while\s*\(\s*true/i);
    expect(s).not.toContain(["/con", "sole/api"].join(""));
    expect(s).not.toMatch(/["'`]\/(v1\/)?(parameters|info)\b/);
    expect(s).not.toMatch(/Promise\.(all|allSettled|race)\s*\(/);
    expect(s).toMatch(/counter\.take\(app\)/);
    expect(s.match(/counter\.take\(/g)).toHaveLength(1);
    expect(s).toContain("DIFY_LIVE");
  });
});
