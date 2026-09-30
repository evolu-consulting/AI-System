import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { depcruiseBin, pickEntries, runDepcruise } from "./depcruise";
import { repoRoot } from "./lib/git";

const ROOT = repoRoot(import.meta.dir);
const FIX = join(import.meta.dir, "__fixtures__");
const SLOW = 60_000; // mỗi lần chạy depcruise mất 1–5 s trên Windows

type Violation = { rule: { name: string }; from: string; to: string };

function cruise(dir: string): Violation[] {
  const r = runDepcruise({
    cwd: join(FIX, dir),
    targets: ["apps"],
    config: join(ROOT, ".dependency-cruiser.cjs"),
    outputType: "json",
    bin: depcruiseBin(ROOT),
  });
  const json = JSON.parse(r.out.slice(r.out.indexOf("{"))) as {
    summary: { violations: Violation[] };
  };
  return json.summary.violations;
}

describe("ADM-NFR-06 · depcruise pickEntries (T-DEP-8)", () => {
  test("chỉ lấy file code dưới apps/ packages/ tools/, bỏ fixture/dist/node_modules", () => {
    expect(
      pickEntries([
        "apps/admin-api/src/app.ts",
        "packages/db/src/x.tsx",
        "tools/a.mjs",
        "tools/b.cjs",
        "tools/c.js",
        "apps/admin-api/README.md",
        "docs/x.ts",
        "tests/acceptance/x.test.ts",
        "tools/scripts/src/__fixtures__/depcruise/apps/x.ts",
        "apps/admin-web/dist/index.js",
        "apps/admin-web/node_modules/a/b.js",
        "package.json",
      ]),
    ).toEqual([
      "apps/admin-api/src/app.ts",
      "packages/db/src/x.tsx",
      "tools/a.mjs",
      "tools/b.cjs",
      "tools/c.js",
    ]);
  });
});

describe("ADM-NFR-06 · luật dependency-cruiser trên fixture", () => {
  test(
    "fixture vi phạm: đủ T-DEP-1, T-DEP-2, T-DEP-3; bun:sqlite không bị coi là unresolvable",
    () => {
      const v = cruise("depcruise");
      const byRule = (name: string) => v.filter((x) => x.rule.name === name);
      expect(byRule("no-routes-to-repo").map((x) => [x.from, x.to])).toEqual([
        ["apps/x-api/src/modules/a/a.routes.ts", "apps/x-api/src/modules/a/a.repo.ts"],
      ]);
      expect(byRule("no-cross-module-repo").map((x) => [x.from, x.to])).toEqual([
        ["apps/x-api/src/modules/a/a.service.ts", "apps/x-api/src/modules/b/b.repo.ts"],
      ]);
      expect(byRule("rules-must-be-pure").map((x) => [x.from, x.to])).toEqual([
        ["apps/x-api/src/modules/a/x.rules.ts", "bun:sqlite"],
      ]);
      expect(byRule("not-to-unresolvable")).toEqual([]);
    },
    SLOW,
  );

  test(
    "fixture sạch (routes → service → rules, test import bun:test) → 0 vi phạm",
    () => {
      expect(cruise("depcruise-clean")).toEqual([]);
    },
    SLOW,
  );
});
