// P-d2 · HUB-FR-146 · luật dựng bước `done:pd2`.
import { describe, expect, it } from "bun:test";
import { summarize } from "./done-pd1.rules";
import { pd2Steps } from "./done-pd2.rules";

describe("HUB-FR-146 · done:pd2", () => {
  const s = pd2Steps({ bun: "bun", platform: "win32", nodeDir: "N" });

  it("đúng 11 bước theo thứ tự T20", () => {
    expect(s).toHaveLength(11);
    expect(s[0]?.argv).toContain("--filter=!@ai/agent-runtime");
    expect(s[1]?.kind).toBe("depcruise");
    expect(s[3]?.argv.slice(-7)).toEqual(
      ["P-d", "P-a", "P-b", "P-b2", "P-c", "P-c2", "H2a"].map((d) => `tests/acceptance/${d}`),
    );
    expect(s[4]?.argv).toEqual(["bun", "run", "test:perf:pd"]);
    expect(s[5]?.title).toBe("playwright P-d");
    expect(s.slice(6, 10).map((x) => x.argv.slice(-1)[0])).toEqual([
      "build",
      "check:bundle",
      "build",
      "check:bundle",
    ]);
    expect(s[6]?.argv).toContain("apps/admin-web");
    expect(s[8]?.argv).toContain("apps/chat-web");
    expect(s[10]?.argv.slice(-1)).toEqual(["test:lock:verify"]);
  });

  it("nodeDir chỉ ở playwright; không nodeDir ⇒ bun x playwright; linux typecheck thường", () => {
    expect(s.filter((x) => x.nodeDir).map((x) => x.title)).toEqual(["playwright P-d"]);
    expect(s[5]?.argv.slice(0, 2)).toEqual(["N\\node.exe", "node_modules/@playwright/test/cli.js"]);
    const l = pd2Steps({ bun: "bun", platform: "linux", nodeDir: null });
    expect(l[0]?.argv).toEqual(["bun", "run", "typecheck"]);
    expect(l[5]?.argv.slice(0, 3)).toEqual(["bun", "x", "playwright"]);
  });

  it("summarize có tên done:pd2", () => {
    expect(summarize([{ title: "a", code: 0, ms: 1 }], "done:pd2").text).toContain("done:pd2 XANH");
  });
});
