// HUB-H2b-AC-13 · `done:h2b` (test-plan H2b §7.1): mọi bước `done:h2a` + phần H2b đúng thứ tự; script/bunfig MK
// (L6: stack/hubdev bỏ khỏi `bun test`/int, `test:h2b:stack` limit 2 tường minh, hub-dev mặc định 20); smoke skip.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HUB_DEV_MAX_CONCURRENT_RUNS, hubApiEnv } from "../../hub-dev/src/dev";
import { h2aSteps } from "./done-h2a";
import { h2bSteps } from "./done-h2b";
import { smokeEnabled } from "./smoke-live";

const ROOT = join(import.meta.dir, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

describe("HUB-H2b-AC-13 · done:h2b", () => {
  const a = h2aSteps({});
  const b = h2bSteps({});
  const titles = b.map((s) => s.title);
  const idx = (prefix: string) => titles.findIndex((t) => t.startsWith(prefix));
  const step = (i: number) => {
    const s = b[i];
    if (!s) throw new Error(`thiếu bước ${i + 1}`);
    return s;
  };

  it("16 bước; bước chặn của done:h2a giữ nguyên thứ tự (unit/int/perf chỉ nối thêm H2b)", () => {
    expect(b).toHaveLength(16);
    const pos = a.map((s) =>
      titles.findIndex((t) => t.startsWith(s.title.split(" tests/")[0] ?? s.title)),
    );
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
  });

  it("unit + int + perf có thư mục H2b", () => {
    expect(b[1]?.argv.at(-1)).toBe("tests/acceptance/H2b/rules");
    expect(b[2]?.argv).toContain("tests/acceptance/H2b/");
    expect(b[2]?.argv.indexOf("tests/acceptance/H2b/")).toBe(
      (b[2]?.argv.indexOf("tests/acceptance/H2a/") ?? -9) + 1,
    );
    expect(b[2]?.argv).toContain("--config=bunfig.int.toml");
    expect(b.at(-1)?.argv.slice(-2)).toEqual(["tests/acceptance/H2a", "tests/acceptance/H2b"]);
  });

  it("stack H2b sau H2a; H01 hubdev (needsDev, HUB_URL/AUTH_URL) ngay sau contract chat", () => {
    expect(idx("bun run test:h2b:stack")).toBe(idx("bun run test:h2a:stack") + 1);
    const contract = step(idx("HUB_URL="));
    expect(contract.argv.slice(1)).toEqual(["run", "test:contract:chat"]);
    const hubdev = step(b.indexOf(contract) + 1);
    expect(hubdev.needsDev).toBe(true);
    expect(hubdev.blocking).toBe(true);
    expect(hubdev.argv).toContain("--config=bunfig.stack.toml");
    expect(hubdev.argv.at(-1)).toBe("tests/acceptance/H2b/hubdev");
    expect(Object.keys(hubdev.env ?? {}).sort()).toEqual(["AUTH_URL", "HUB_URL"]);
  });

  it("chỉ hai bước báo cáo, đứng cuối", () => {
    expect(b.filter((s) => !s.blocking).map((s) => s.title)).toEqual([
      "tsc -p tsconfig.tests.json",
      "bun run test:perf tests/acceptance/H2a tests/acceptance/H2b",
    ]);
    expect(b.slice(-2).every((s) => !s.blocking)).toBe(true);
  });

  it("python: env DB nằm trong chuỗi lệnh `scripts/run.ts`", () => {
    const py = step(4);
    expect(py.argv[1]).toBe("apps/agent-runtime/scripts/run.ts");
    expect(py.argv[2]).toContain("export HUB_TEST_DATABASE_URL=");
    expect(py.argv[2]).toContain("AGENT_RT_TEST_DATABASE_URL=");
  });
});

describe("MK · script + bunfig", () => {
  it("done:h2b, test:h2b:stack (limit 2 tường minh, bunfig.stack), test:smoke:live", () => {
    expect(pkg.scripts["done:h2b"]).toContain("tools/scripts/src/done-h2b.ts");
    const stack = pkg.scripts["test:h2b:stack"] ?? "";
    expect(stack.startsWith("HUB_MAX_CONCURRENT_RUNS=2 ")).toBe(true);
    expect(stack).toContain("--config=bunfig.stack.toml");
    expect(stack.endsWith("tests/acceptance/H2b/stack")).toBe(true);
    expect(pkg.scripts["test:smoke:live"]).toContain("smoke-live.ts");
  });

  it("bunfig.toml + bunfig.int.toml bỏ H2b/{stack,hubdev}; bunfig.stack.toml không bỏ", () => {
    for (const f of ["bunfig.toml", "bunfig.int.toml"]) {
      expect(read(f)).toContain('"tests/acceptance/H2b/stack/**"');
      expect(read(f)).toContain('"tests/acceptance/H2b/hubdev/**"');
    }
    const ignore = read("bunfig.stack.toml").match(/^pathIgnorePatterns = .*$/m)?.[0] ?? "";
    expect(ignore).toContain("e2e/**");
    expect(ignore).not.toContain("tests/");
  });

  it("hub-dev: HUB_MAX_CONCURRENT_RUNS mặc định 20, env ghi đè", () => {
    expect(HUB_DEV_MAX_CONCURRENT_RUNS).toBe("20");
    expect(hubApiEnv({}).HUB_MAX_CONCURRENT_RUNS).toBe("20");
    expect(hubApiEnv({ HUB_MAX_CONCURRENT_RUNS: "5" }).HUB_MAX_CONCURRENT_RUNS).toBe("5");
    expect(hubApiEnv({}).HUB_PORT).toBe("4000");
  });

  it("smoke live: vắng/0 → bỏ qua; 1 → chạy", () => {
    expect(smokeEnabled({})).toBe(false);
    expect(smokeEnabled({ HUB_LIVE: "0" })).toBe(false);
    expect(smokeEnabled({ HUB_LIVE: "1" })).toBe(true);
  });
});
