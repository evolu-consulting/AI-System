// N1 · luật dựng bước `done:n1` + run-playwright.
import { describe, expect, it } from "bun:test";
import { n1Steps, playwrightArgv } from "./done-n1.rules";

describe("done:n1", () => {
  const s = n1Steps({ bun: "bun", platform: "win32", nodeDir: "N" });

  it("16 bước đúng thứ tự", () => {
    expect(s).toHaveLength(16);
    expect(s[0]?.argv).toContain("--filter=!@ai/agent-runtime");
    expect(s[1]?.kind).toBe("depcruise");
    expect(s[1]?.rulePrefixes).toEqual(["ca-", "pack-"]);
  });

  it("int có hồi quy admin + packages/db; perf đặt PERF=1", () => {
    const a = s[3]?.argv ?? [];
    expect(a).toContain("tests/acceptance/ADM-NFR-06");
    expect(a).toContain("tests/acceptance/HD1");
    expect(a.at(-1)).toBe("packages/db/src");
    expect(s[4]?.env).toEqual({ PERF: "1" });
    expect(s[4]?.argv.at(-1)).toBe("tests/acceptance/N1/perf/");
  });

  it("playwright gọi node thật; không nodeDir ⇒ bun x", () => {
    expect(s.filter((x) => x.nodeDir).map((x) => x.title)).toEqual([
      "playwright N1",
      "playwright contracts-web",
      "playwright chat",
    ]);
    expect(s[6]?.argv).toEqual([
      "N\\node.exe",
      "node_modules/@playwright/test/cli.js",
      "test",
      "-c",
      "e2e/contracts-web/playwright.config.ts",
    ]);
    expect(
      playwrightArgv({ bun: "bun", platform: "linux", nodeDir: null }, "c.ts", ["-x"]),
    ).toEqual(["bun", "x", "playwright", "test", "-c", "c.ts", "-x"]);
  });

  it("build + check:bundle cho 3 web; check:fn; lock cuối", () => {
    expect(s.slice(8, 14).map((x) => x.argv.at(-1))).toEqual([
      "build",
      "check:bundle",
      "build",
      "check:bundle",
      "build",
      "check:bundle",
    ]);
    expect(s.at(-1)?.argv.at(-1)).toBe("test:lock:verify");
  });
});
