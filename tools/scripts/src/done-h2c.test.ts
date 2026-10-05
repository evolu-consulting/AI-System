// HUB-H2c · AC-H03 · `done:h2c` (test-plan H2c §7.1): đủ 18 bước, mọi bước `done:h2b` giữ thứ tự + phần H2c;
// script/bunfig/env MK (stack/hubdev H2c bỏ khỏi `bun test`/int, `test:h2c:stack` limit 2 + driver local, hub-dev attach).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_URL, HUB_URL, hubApiEnv } from "../../hub-dev/src/dev";
import { h2bSteps } from "./done-h2b";
import { h2cSteps } from "./done-h2c";

const ROOT = join(import.meta.dir, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

const b = h2bSteps({});
const c = h2cSteps({});
const titles = c.map((s) => s.title);
const idx = (prefix: string) => titles.findIndex((t) => t.startsWith(prefix));
const step = (i: number) => {
  const s = c[i];
  if (!s) throw new Error(`thiếu bước ${i + 1}`);
  return s;
};

describe("HUB-H2c · done:h2c", () => {
  it("18 bước; mọi bước done:h2b có mặt, giữ thứ tự (unit/int/perf chỉ nối thêm H2c)", () => {
    expect(c).toHaveLength(18);
    const pos = b.map((s) =>
      titles.findIndex((t) => t.startsWith(s.title.split(" tests/")[0] ?? s.title)),
    );
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
    for (const s of b.filter((x) => !/^bun (test|--env-file)|^bun run test:perf/.test(x.title)))
      expect(titles).toContain(s.title);
  });

  it("unit + int + perf có thư mục H2c", () => {
    expect(step(1).argv.slice(-2)).toEqual([
      "tests/acceptance/H2b/rules",
      "tests/acceptance/H2c/rules",
    ]);
    const int = step(2).argv;
    expect(int).toContain("--config=bunfig.int.toml");
    expect(int.indexOf("tests/acceptance/H2c/")).toBe(int.indexOf("tests/acceptance/H2b/") + 1);
    expect(int.at(-2)).toBe("tests/acceptance/M");
    expect(c.at(-1)?.argv.slice(-3)).toEqual([
      "tests/acceptance/H2a",
      "tests/acceptance/H2b",
      "tests/acceptance/H2c",
    ]);
  });

  it("stack H2c (bước 9) sau H2b; H01 H2c (needsDev) ngay sau H01 H2b, sau contract chat", () => {
    expect(idx("bun run test:h2c:stack")).toBe(8);
    expect(idx("bun run test:h2c:stack")).toBe(idx("bun run test:h2b:stack") + 1);
    expect(step(9).argv.slice(1)).toEqual(["run", "test:contract:chat"]);
    expect(step(10).argv.at(-1)).toBe("tests/acceptance/H2b/hubdev");
    const h01 = step(11);
    expect(h01.needsDev).toBe(true);
    expect(h01.blocking).toBe(true);
    expect(h01.argv).toContain("--config=bunfig.stack.toml");
    expect(h01.argv.at(-1)).toBe("tests/acceptance/H2c/hubdev");
    expect(h01.env).toEqual({ HUB_URL, AUTH_URL });
  });
});

describe("HUB-H2c · done:h2c — khoá, báo cáo, python", () => {
  it("13–16 khoá/trace/size/depcruise; chỉ hai bước báo cáo, đứng cuối", () => {
    expect(titles.slice(12, 16).map((t) => t.split(" ").slice(0, 3).join(" "))).toEqual([
      "bun run test:lock:verify",
      "bun run trace",
      "bun run check:size",
      "bunx depcruise apps/hub-api",
    ]);
    expect(c.filter((s) => !s.blocking).map((s) => s.title)).toEqual([
      "tsc -p tsconfig.tests.json",
      "bun run test:perf tests/acceptance/H2a tests/acceptance/H2b tests/acceptance/H2c",
    ]);
  });

  it("python: như done:h2b (env DB trong chuỗi lệnh `scripts/run.ts`)", () => {
    expect(step(4)).toEqual(b[4] as (typeof c)[number]);
    expect(step(4).argv[2]).toContain("export HUB_TEST_DATABASE_URL=");
  });
});

describe("MK H2c · script + bunfig + env", () => {
  it("done:h2c, test:h2c:stack (limit 2, driver local, bunfig.stack)", () => {
    expect(pkg.scripts["done:h2c"]).toBe("bun --env-file=.env.local tools/scripts/src/done-h2c.ts");
    const stack = pkg.scripts["test:h2c:stack"] ?? "";
    expect(stack.startsWith("HUB_MAX_CONCURRENT_RUNS=2 HUB_ATTACH_DRIVER=local ")).toBe(true);
    expect(stack).toContain("--config=bunfig.stack.toml");
    expect(stack.endsWith("tests/acceptance/H2c/stack")).toBe(true);
  });

  it("bunfig.toml + bunfig.int.toml bỏ H2c/{stack,hubdev}; bunfig.stack.toml không bỏ", () => {
    for (const f of ["bunfig.toml", "bunfig.int.toml"]) {
      expect(read(f)).toContain('"tests/acceptance/H2c/stack/**"');
      expect(read(f)).toContain('"tests/acceptance/H2c/hubdev/**"');
    }
    const ignore = read("bunfig.stack.toml").match(/^pathIgnorePatterns = .*$/m)?.[0] ?? "";
    expect(ignore).not.toContain("tests/");
  });

  it(".gitignore `.data/`; .env.example có HUB_ATTACH_* và AGENT_RT_HUB_URL", () => {
    expect(read(".gitignore").split(/\r?\n/)).toContain(".data/");
    const ex = read(".env.example");
    for (const k of [
      "HUB_ATTACH_DRIVER=local",
      "HUB_ATTACH_DIR=",
      "HUB_ATTACH_TENANT_MAX_BYTES=",
      "HUB_ATTACH_SWEEP_S=",
      "AGENT_RT_HUB_URL=",
    ])
      expect(ex.split(/\r?\n/)).toContain(k);
  });

  it("hub-dev: HUB_ATTACH_DRIVER=local; DIR = env nếu có, không thì thư mục tạm; giữ env H2b", () => {
    expect(hubApiEnv({}).HUB_ATTACH_DRIVER).toBe("local");
    expect(hubApiEnv({}).HUB_ATTACH_DIR).toBeUndefined();
    expect(hubApiEnv({}, "/tmp/hub-dev-attach-x").HUB_ATTACH_DIR).toBe("/tmp/hub-dev-attach-x");
    expect(hubApiEnv({ HUB_ATTACH_DIR: " " }, "/tmp/t").HUB_ATTACH_DIR).toBe("/tmp/t");
    expect(hubApiEnv({ HUB_ATTACH_DIR: "/srv/a" }, "/tmp/t").HUB_ATTACH_DIR).toBe("/srv/a");
    expect(hubApiEnv({}, "/tmp/t").HUB_MAX_CONCURRENT_RUNS).toBe("20");
  });
});
