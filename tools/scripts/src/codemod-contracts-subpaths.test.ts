import { describe, expect, test } from "bun:test";
import { exportTarget, rewriteSource, subpathOfFile } from "./codemod-contracts-subpaths.rules";

const MAP: Record<string, string> = {
  A: "access",
  B: "access",
  C: "common",
  F: "flow",
  Z: "community",
};
const resolve = (n: string) => MAP[n];

describe("subpathOfFile", () => {
  test("file gốc / thư mục / alias", () => {
    expect(subpathOfFile("access.ts")).toBe("access");
    expect(subpathOfFile("flow/cond.ts")).toBe("flow");
    expect(subpathOfFile("pack-community/x/y.ts")).toBe("community");
  });
});

describe("exportTarget", () => {
  test("thư mục có index ⇒ index.ts; không ⇒ file", () => {
    const dirOf = (s: string) => (s === "flow" ? "flow" : null);
    expect(exportTarget("flow", dirOf)).toBe("./src/flow/index.ts");
    expect(exportTarget("access", dirOf)).toBe("./src/access.ts");
  });
});

describe("rewriteSource", () => {
  test("tách theo subpath, giữ type/alias", () => {
    const src = `import { A, type C, F as G, B } from "@ai/contracts";\nconst x = 1;\n`;
    const r = rewriteSource(src, resolve);
    expect(r.changed).toBe(true);
    expect(r.text).toBe(
      `import { A, B } from "@ai/contracts/access";\nimport { type C } from "@ai/contracts/common";\nimport { F as G } from "@ai/contracts/flow";\nconst x = 1;\n`,
    );
  });

  test("import type và export from", () => {
    const r = rewriteSource(
      `import type { A, C } from "@ai/contracts";\nexport { type F } from "@ai/contracts";\n`,
      resolve,
    );
    expect(r.text).toBe(
      `import type { A } from "@ai/contracts/access";\nimport type { C } from "@ai/contracts/common";\nexport { type F } from "@ai/contracts/flow";\n`,
    );
  });

  test("idempotent: subpath và namespace import giữ nguyên", () => {
    const a = `import { A } from "@ai/contracts/access";\n`;
    expect(rewriteSource(a, resolve).changed).toBe(false);
    const ns = `import * as C from "@ai/contracts";\n`;
    const r = rewriteSource(ns, resolve);
    expect(r.changed).toBe(false);
    expect(r.skipped).toHaveLength(1);
  });

  test("tên không rõ nguồn ⇒ giữ nguyên cả câu và báo", () => {
    const src = `import { A, Nope } from "@ai/contracts";\n`;
    const r = rewriteSource(src, resolve);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(src);
    expect(r.skipped).toHaveLength(1);
  });

  test("chạy lần hai trên kết quả lần một không đổi", () => {
    const once = rewriteSource(`import { A, C } from "@ai/contracts";\n`, resolve).text;
    expect(rewriteSource(once, resolve).changed).toBe(false);
  });
});
