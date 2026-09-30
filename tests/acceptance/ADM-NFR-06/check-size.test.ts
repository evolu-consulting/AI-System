import { afterEach, describe, expect, it } from "bun:test";
import { codeLines, makeRepo, removeRepo, run, scriptPath } from "./_helpers";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeRepo(dirs.pop() as string);
});

function check(files: Record<string, string>) {
  const dir = makeRepo(files);
  dirs.push(dir);
  return run(["bun", scriptPath("check-size.ts"), "--files", ...Object.keys(files)], dir);
}

describe("ADM-NFR-06 · M0-AC11 · check:size (T-SIZE-1..5)", () => {
  it("ADM-NFR-06 · M0-AC11 · file code 401 dòng → exit 1, in dòng vi phạm", () => {
    const r = check({ "apps/admin-api/src/tmp-401.ts": codeLines(401) });
    expect(r.code).toBe(1);
    expect(r.out).toContain("apps/admin-api/src/tmp-401.ts: 401 dòng > 400");
  });

  it("ADM-NFR-06 · M0-AC11 · file code 400 dòng → exit 0, in check:size OK (1 file)", () => {
    const r = check({ "apps/admin-api/src/tmp-401.ts": codeLines(400) });
    expect(r.code).toBe(0);
    expect(r.out).toContain("check:size OK (1 file)");
    expect(r.out).not.toContain("dòng >");
  });

  it("ADM-NFR-06 · M0-AC11 · đếm dòng: 400 dòng không có \\n cuối vẫn là 400; 401 dòng không có \\n cuối là vi phạm", () => {
    const noTrailing400 = codeLines(400).slice(0, -1);
    expect(check({ "apps/admin-api/src/a.ts": noTrailing400 }).code).toBe(0);
    const noTrailing401 = codeLines(401).slice(0, -1);
    const r = check({ "apps/admin-api/src/b.ts": noTrailing401 });
    expect(r.code).toBe(1);
    expect(r.out).toContain("apps/admin-api/src/b.ts: 401 dòng > 400");
  });

  it("ADM-NFR-06 · M0-AC11 · file rỗng = 0 dòng → OK", () => {
    expect(check({ "apps/admin-api/src/empty.ts": "" }).code).toBe(0);
  });

  it("ADM-NFR-06 · M0-AC11 · file test: 600 dòng OK, 601 dòng vi phạm (*.test.ts và dưới tests/)", () => {
    expect(check({ "apps/admin-api/src/big.test.ts": codeLines(600) }).code).toBe(0);
    const a = check({ "apps/admin-api/src/big.test.ts": codeLines(601) });
    expect(a.code).toBe(1);
    expect(a.out).toContain("apps/admin-api/src/big.test.ts: 601 dòng > 600");
    expect(check({ "tests/acceptance/X/helper.ts": codeLines(500) }).code).toBe(0);
    const b = check({ "tests/acceptance/X/helper.ts": codeLines(601) });
    expect(b.out).toContain("tests/acceptance/X/helper.ts: 601 dòng > 600");
  });

  it("ADM-NFR-06 · M0-AC11 · miễn trừ: components/ui, migrations, *.gen.ts không bị tính", () => {
    const r = check({
      "apps/admin-web/src/components/ui/button.tsx": codeLines(500),
      "packages/db/migrations/0001_big.ts": codeLines(500),
      "apps/admin-web/src/routeTree.gen.ts": codeLines(500),
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("dòng >");
  });

  it("ADM-NFR-06 · M0-AC11 · file không phải code (.md, .json, .sql) không bị tính", () => {
    const r = check({
      "docs/long.md": codeLines(1000),
      "data.json": codeLines(1000),
      "packages/db/q.sql": codeLines(1000),
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("dòng >");
  });

  it("ADM-NFR-06 · M0-AC11 · nhiều vi phạm → mỗi file một dòng, exit 1", () => {
    const r = check({
      "apps/admin-api/src/p.ts": codeLines(401),
      "apps/admin-api/src/q.ts": codeLines(402),
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("apps/admin-api/src/p.ts: 401 dòng > 400");
    expect(r.out).toContain("apps/admin-api/src/q.ts: 402 dòng > 400");
  });
});
