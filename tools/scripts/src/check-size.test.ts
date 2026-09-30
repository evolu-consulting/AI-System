import { describe, expect, test } from "bun:test";
import { checkFiles, countLines, limitFor } from "./check-size";

const lines = (n: number) => "x\n".repeat(n);

describe("ADM-NFR-06 · check:size countLines (T-SIZE-1)", () => {
  test.each([
    ["", 0],
    ["a", 1],
    ["a\n", 1],
    ["a\nb", 2],
    ["a\nb\n", 2],
    ["\n", 1],
    ["a\r\nb\r\n", 2],
  ])("%j → %d", (text, n) => {
    expect(countLines(text)).toBe(n);
  });
});

describe("ADM-NFR-06 · check:size limitFor (T-SIZE-1…3)", () => {
  test.each([
    ["apps/admin-api/src/app.ts", 400],
    ["tools/x.mjs", 400],
    ["a.cjs", 400],
    ["apps/admin-web/src/A.tsx", 400],
    ["apps/admin-api/src/app.test.ts", 600],
    ["e2e/smoke.spec.ts", 600],
    ["apps/admin-web/src/A.test.tsx", 600],
    ["tests/acceptance/X/_helpers.ts", 600],
    ["e2e/helpers.ts", 600],
    ["apps/admin-web/src/components/ui/button.tsx", null],
    ["packages/db/migrations/0001.ts", null],
    ["packages/db/migrations-dev/x.ts", null],
    ["apps/admin-web/src/routeTree.gen.ts", null],
    ["x.generated.ts", null],
    ["docs/TRACE.md", null],
    ["bun.lock", null],
    ["a.json", null],
    ["q.sql", null],
  ])("%s → %p", (path, want) => {
    expect(limitFor(path)).toBe(want);
  });
});

describe("ADM-NFR-06 · check:size checkFiles (T-SIZE-5)", () => {
  test("400 OK, 401 vi phạm; test 600 OK, 601 vi phạm; miễn trừ bỏ qua", () => {
    expect(
      checkFiles([
        { path: "a.ts", text: lines(400) },
        { path: "b.ts", text: lines(401) },
        { path: "c.test.ts", text: lines(600) },
        { path: "d.test.ts", text: lines(601) },
        { path: "src/components/ui/e.tsx", text: lines(900) },
        { path: "f.md", text: lines(900) },
      ]),
    ).toEqual([
      { path: "b.ts", lines: 401, limit: 400 },
      { path: "d.test.ts", lines: 601, limit: 600 },
    ]);
  });

  test("401 dòng không có \\n cuối vẫn vi phạm", () => {
    expect(checkFiles([{ path: "a.ts", text: lines(401).slice(0, -1) }])).toHaveLength(1);
    expect(checkFiles([{ path: "a.ts", text: lines(400).slice(0, -1) }])).toHaveLength(0);
  });
});
