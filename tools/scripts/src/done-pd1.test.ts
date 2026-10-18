// P-d1 · HUB-FR-143 · luật dựng bước `done:pd1`.
import { describe, expect, it } from "bun:test";
import {
  isRealNode,
  parseDepcruise,
  pd1Steps,
  prependPath,
  resolveNodeDir,
  summarize,
} from "./done-pd1.rules";

describe("HUB-FR-143 · done:pd1", () => {
  it("resolveNodeDir: node có trên PATH -> null; thiếu -> thư mục mặc định nếu tồn tại; override thắng", () => {
    const yes = () => true;
    expect(resolveNodeDir({ nodeOnPath: true, exists: yes })).toBeNull();
    expect(resolveNodeDir({ nodeOnPath: false, exists: () => false })).toBeNull();
    expect(resolveNodeDir({ nodeOnPath: false, exists: yes })).toContain("node-22");
    expect(resolveNodeDir({ override: "D:\\n", nodeOnPath: true, exists: yes })).toBe("D:\\n");
  });

  it("isRealNode: shim bun-node hoặc trỏ tới bun.exe không phải Node", () => {
    expect(isRealNode("C:\\Temp\\bun-node-abc123\\node.exe")).toBe(false);
    expect(isRealNode("C:\\TEMP\\BUN-NODE-1\\node.exe")).toBe(false);
    expect(isRealNode("C:\\x\\node.exe", "C:\\Users\\a\\.bun\\bin\\bun.exe")).toBe(false);
    expect(isRealNode(null)).toBe(false);
    expect(
      isRealNode("C:\\Program Files\\nodejs\\node.exe", "C:\\Program Files\\nodejs\\node.exe"),
    ).toBe(true);
  });

  it("parseDepcruise: chỉ đếm ca-* riêng, tổng gồm cả vi phạm cũ", () => {
    const out = [
      "  error no-cross-module-repo: a.ts → ",
      "b.ts",
      "  error no-circular: a.ts → ",
      "      b.ts →",
      "  error component-no-fetch: c.tsx → ",
      "x 3 dependency violations (3 errors, 0 warnings). 10 modules",
    ].join("\n");
    expect(parseDepcruise(out)).toEqual({ total: 3, ca: 0 });
    expect(parseDepcruise(`${out}\n  error ca-domain-no-adapters: d.ts → e.ts`)).toEqual({
      total: 4,
      ca: 1,
    });
    expect(parseDepcruise("")).toEqual({ total: 0, ca: 0 });
  });

  it("prependPath đặt thư mục đầu", () => {
    expect(prependPath("A", "B;C", ";")).toBe("A;B;C");
    expect(prependPath("A", undefined, ";")).toBe("A");
  });
});

describe("HUB-FR-143 · done:pd1 · bước + tổng kết", () => {
  it("pd1Steps: đúng 7 bước theo thứ tự, typecheck Windows bỏ agent-runtime, nodeDir chỉ ở e2e", () => {
    const s = pd1Steps({ bun: "bun", platform: "win32", nodeDir: "N" });
    expect(s).toHaveLength(7);
    expect(s[0]?.argv).toContain("--filter=!@ai/agent-runtime");
    expect(s[1]?.argv).toContain("--all");
    expect(s[3]?.argv.slice(-6)).toEqual(
      ["P-d", "P-a", "P-b", "P-b2", "P-c", "P-c2"].map((d) => `tests/acceptance/${d}`),
    );
    expect(s.filter((x) => x.nodeDir).map((x) => x.title)).toEqual(["playwright P-d"]);
    expect(s.find((x) => x.nodeDir)?.argv.slice(0, 2)).toEqual([
      "N\\node.exe",
      "node_modules/@playwright/test/cli.js",
    ]);
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
