import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { depcruiseBin, pickEntries, runDepcruise } from "./depcruise";
import { repoRoot } from "./lib/git";

const ROOT = repoRoot(import.meta.dir);
const FIX = join(import.meta.dir, "__fixtures__");
const SLOW = 60_000; // mỗi lần chạy depcruise mất 1–5 s trên Windows

type Violation = { rule: { name: string }; from: string; to: string };

function cruise(dir: string, targets: string[] = ["apps"]): Violation[] {
  const r = runDepcruise({
    cwd: join(FIX, dir),
    targets,
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
    "fixture vi phạm: mỗi luật T-DEP-1…7 bắt đúng cạnh; bun:sqlite là core, không unresolvable",
    () => {
      const v = cruise("depcruise", ["apps", "packages"]);
      const byRule = (name: string) =>
        v
          .filter((x) => x.rule.name === name)
          .map((x) => [x.from, x.to])
          .sort((a, b) => `${a}`.localeCompare(`${b}`));
      // Gói npm resolve qua store của linker isolated: `…/node_modules/.bun/hono@<v>/node_modules/hono/dist/…`.
      // Cạnh này từng bị `exclude: (^|/)dist/` nuốt mất (review M0 vòng 1 #1).
      const HONO = /(^|\/)node_modules\/\.bun\/hono@[^/]+\/node_modules\/hono\/dist\//;
      const npmTo = (name: string) =>
        byRule(name).map(([from, to]) => [from, HONO.test(to ?? "") ? "hono" : to]);

      expect(byRule("no-routes-to-repo")).toEqual([
        ["apps/x-api/src/modules/a/a.routes.ts", "apps/x-api/src/modules/a/a.repo.ts"],
      ]);
      expect(byRule("no-cross-module-repo")).toEqual([
        ["apps/x-api/src/modules/a/a.service.ts", "apps/x-api/src/modules/b/b.repo.ts"],
      ]);
      expect(npmTo("rules-must-be-pure")).toEqual([
        ["apps/x-api/src/modules/a/x.rules.ts", "bun:sqlite"],
        ["apps/x-api/src/modules/b/y.rules.ts", "hono"],
      ]);
      expect(npmTo("service-no-http")).toEqual([["apps/x-api/src/modules/b/b.service.ts", "hono"]]);
      expect(byRule("component-no-fetch")).toEqual([
        ["apps/x-web/src/features/f/components/Btn.tsx", "apps/x-web/src/features/f/api.ts"],
        ["apps/x-web/src/features/f/components/Btn.tsx", "apps/x-web/src/lib/http.ts"],
      ]);
      expect(byRule("web-no-db-or-api")).toEqual([
        ["apps/x-web/src/pages/p.ts", "apps/x-api/src/lib/util.ts"],
        ["apps/x-web/src/pages/p.ts", "packages/db/src/index.ts"],
      ]);
      expect(byRule("api-no-web")).toEqual([
        ["apps/x-api/src/lib/to-web.ts", "apps/x-web/src/lib/fmt.ts"],
      ]);
      expect(byRule("contracts-pure")).toEqual([
        ["packages/contracts/src/a.ts", "apps/x-api/src/lib/util.ts"],
        ["packages/contracts/src/a.ts", "packages/db/src/index.ts"],
      ]);
      const circ = byRule("no-circular");
      expect(circ.length).toBeGreaterThanOrEqual(1);
      for (const [from, to] of circ) {
        expect([from, to].sort()).toEqual(["apps/x-api/src/lib/c1.ts", "apps/x-api/src/lib/c2.ts"]);
      }
      expect(byRule("not-to-unresolvable")).toEqual([
        ["apps/x-api/src/lib/missing.ts", "./khong-ton-tai"],
      ]);
      // Không luật nào ngoài 10 luật đã khai.
      expect(v.length).toBe(13 + circ.length);
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
