// P-d1 · HUB-FR-143 · luật dựng bước `done:pd1`.
import { describe, expect, it } from "bun:test";
import { pd1Steps, prependPath, resolveNodeDir, summarize } from "./done-pd1.rules";

describe("HUB-FR-143 · done:pd1", () => {
  it("resolveNodeDir: node có trên PATH -> null; thiếu -> thư mục mặc định nếu tồn tại; override thắng", () => {
    const yes = () => true;
    expect(resolveNodeDir({ nodeOnPath: true, exists: yes })).toBeNull();
    expect(resolveNodeDir({ nodeOnPath: false, exists: () => false })).toBeNull();
    expect(resolveNodeDir({ nodeOnPath: false, exists: yes })).toContain("node-22");
    expect(resolveNodeDir({ override: "D:\\n", nodeOnPath: true, exists: yes })).toBe("D:\\n");
  });

  it("prependPath đặt thư mục đầu", () => {
    expect(prependPath("A", "B;C", ";")).toBe("A;B;C");
    expect(prependPath("A", undefined, ";")).toBe("A");
  });

  it("pd1Steps: đúng 7 bước theo thứ tự, typecheck Windows bỏ agent-runtime, nodeDir chỉ ở e2e", () => {
    const s = pd1Steps({ bun: "bun", platform: "win32", nodeDir: "N" });
    expect(s).toHaveLength(7);
    expect(s[0]?.argv).toContain("--filter=!@ai/agent-runtime");
    expect(s[1]?.argv).toContain("--all");
    expect(s[3]?.argv.slice(-6)).toEqual(
      ["P-d", "P-a", "P-b", "P-b2", "P-c", "P-c2"].map((d) => `tests/acceptance/${d}`),
    );
    expect(s.filter((x) => x.nodeDir).map((x) => x.title)).toEqual(["playwright P-d"]);
    expect(pd1Steps({ bun: "bun", platform: "linux", nodeDir: null })[0]?.argv).toEqual([
      "bun",
      "run",
      "typecheck",
    ]);
  });

  it("summarize: xanh khi mọi mã 0; đỏ đếm đúng, vẫn liệt kê hết", () => {
    expect(summarize([{ title: "a", code: 0, ms: 1 }]).ok).toBe(true);
    const r = summarize([
      { title: "a", code: 1, ms: 1 },
      { title: "b", code: 0, ms: 1 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("1/2 bước đỏ");
    expect(summarize([]).ok).toBe(false);
  });
});
