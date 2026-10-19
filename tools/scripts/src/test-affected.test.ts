// TS1 · test:affected: đồ thị import (fixture tạm), bao đóng ngược, chọn unit/int/e2e, và kiểm trên chính repo này.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  affectedBy,
  buildGraph,
  reachableFrom,
  resolveSpecifier,
  workspacePackages,
} from "./lib/import-graph";
import {
  compact,
  configInfos,
  configOfSpec,
  GLOBAL_FILES,
  MIGRATION_SEEDS,
  parseAffectedArgs,
  planAffected,
} from "./test-affected.rules";
import { findE2eConfigs } from "./test-all.discover";

let dir: string;
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "affected-"));
  put(
    "packages/lib/package.json",
    JSON.stringify({
      name: "@ai/lib",
      exports: { ".": "./src/index.ts", "./sub": "./src/sub.ts", "./x/*": "./src/x/*.ts" },
    }),
  );
  put("packages/lib/src/index.ts", 'export * from "./core";');
  put("packages/lib/src/core.ts", "export const a = 1;");
  put("packages/lib/src/sub.ts", "export const s = 2;");
  put("packages/lib/src/x/deep.ts", "export const d = 3;");
  put(
    "apps/web/src/main.ts",
    'import { a } from "@ai/lib"; import { u } from "~/util"; import "./style.css"; export { a, u };',
  );
  put("apps/web/src/util.ts", 'export const u = import("./lazy");');
  put("apps/web/src/lazy.ts", "export default 1;");
  put("apps/web/src/style.css", "a{}");
  put("apps/web/src/main.test.ts", 'import "./main";');
  put(
    "tests/acceptance/Z/spawn.int.test.ts",
    'Bun.spawn(["bun", "apps/web/src/lazy.ts"]); import "@ai/lib/sub"; import "@ai/lib/x/deep";',
  );
  put(
    "e2e/Q/playwright.q.config.ts",
    'export default { testMatch: "**/*.qq.ts", command: "bun e2e/Q/_stack.ts" };',
  );
  put("e2e/Q/_stack.ts", 'import "../../apps/web/src/util";');
  put("e2e/Q/a.qq.ts", 'import "./_support";');
  put("e2e/Q/_support.ts", "export const s = 1;");
  put("e2e/playwright.config.ts", 'export default { testMatch: "**/*.spec.ts" };');
  put("e2e/root-one.spec.ts", 'import "./support/h";');
  put("e2e/support/h.ts", "export const h = 1;");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("TS1 · import-graph", () => {
  it("phân giải tương đối, alias ~/, gói workspace (exports, wildcard), css, import động, đường dẫn trong chuỗi", () => {
    const pkgs = workspacePackages(dir);
    expect(resolveSpecifier(dir, pkgs, "apps/web/src/main.ts", "~/util")).toBe(
      "apps/web/src/util.ts",
    );
    expect(resolveSpecifier(dir, pkgs, "apps/web/src/main.ts", "./style.css")).toBe(
      "apps/web/src/style.css",
    );
    expect(resolveSpecifier(dir, pkgs, "x.ts", "@ai/lib")).toBe("packages/lib/src/index.ts");
    expect(resolveSpecifier(dir, pkgs, "x.ts", "@ai/lib/x/deep")).toBe(
      "packages/lib/src/x/deep.ts",
    );
    expect(resolveSpecifier(dir, pkgs, "x.ts", "zod")).toBeUndefined();
    const g = buildGraph(dir);
    expect(g.deps.get("apps/web/src/util.ts")).toEqual(["apps/web/src/lazy.ts"]);
    expect(g.deps.get("tests/acceptance/Z/spawn.int.test.ts")).toContain("apps/web/src/lazy.ts");
  });

  it("bao đóng ngược: đổi core.ts ⇒ index, main, test của app; không kéo file không liên quan", () => {
    const g = buildGraph(dir);
    const a = affectedBy(g, ["packages/lib/src/core.ts"]);
    expect([...a].sort()).toEqual([
      "apps/web/src/main.test.ts",
      "apps/web/src/main.ts",
      "packages/lib/src/core.ts",
      "packages/lib/src/index.ts",
    ]);
    expect(
      affectedBy(g, ["packages/lib/src/sub.ts"]).has("tests/acceptance/Z/spawn.int.test.ts"),
    ).toBe(true);
    expect(reachableFrom(g, ["e2e/Q/_stack.ts"])).toEqual(
      new Set(["e2e/Q/_stack.ts", "apps/web/src/util.ts", "apps/web/src/lazy.ts"]),
    );
  });
});

const configs = ["e2e/Q/playwright.q.config.ts", "e2e/playwright.config.ts"];
const infos = configInfos(configs, (c) =>
  c.includes("/Q/") ? 'testMatch: "**/*.qq.ts"' : "export default {}",
);
/** Kế hoạch cho danh sách file đổi trên đồ thị của fixture tạm. */
function planFor() {
  return (changed: string[], mode: "owner" | "wide" | "none" = "owner") => {
    const g = buildGraph(dir);
    return planAffected({
      changed,
      affected: affectedBy(g, changed),
      e2eAffected: affectedBy(
        g,
        changed.filter((f) => f.startsWith("e2e/")),
      ),
      infos,
      exists: () => true,
      ignoredUnit: () => false,
      ignoredInt: () => false,
      opts: { e2e: mode },
    });
  };
}

describe("TS1 · chọn test (unit, e2e)", () => {
  const plan = planFor();

  it("configOfSpec: theo đuôi tag; *.spec.ts ⇒ cấu hình gốc; file lạ ⇒ không có", () => {
    expect(infos.map((i) => i.tag)).toEqual(["qq", undefined]);
    expect(configOfSpec("e2e/Q/a.qq.ts", infos)).toBe("e2e/Q/playwright.q.config.ts");
    expect(configOfSpec("e2e/root-one.spec.ts", infos)).toBe("e2e/playwright.config.ts");
    expect(configOfSpec("e2e/Q/_support.ts", infos)).toBeUndefined();
    expect(configOfSpec("apps/web/src/main.ts", infos)).toBeUndefined();
  });

  it("đổi lõi gói: unit của app + int dính tới; không e2e (app web không có chủ ở fixture)", () => {
    const p = plan(["packages/lib/src/core.ts"]);
    expect(p.unit).toEqual(["apps/web/src/main.test.ts"]);
    expect(p.int).toEqual([]);
    expect(p.e2e).toEqual([]);
    expect(p.typecheck).toBe(true);
    expect(p.typecheckTests).toBe(false);
  });

  it("đổi helper e2e: cấu hình của spec import nó (qua đồ thị), không cấu hình khác", () => {
    expect(plan(["e2e/Q/_support.ts"]).e2e).toEqual(["e2e/Q/playwright.q.config.ts"]);
    expect(plan(["e2e/support/h.ts"]).e2e).toEqual(["e2e/playwright.config.ts"]);
    expect(plan(["e2e/support/h.ts"]).typecheckTests).toBe(true);
  });

  it("stack e2e nối tới mã app: owner = chỉ khi chính e2e đổi; wide = cả khi mã app đổi", () => {
    expect(plan(["apps/web/src/lazy.ts"], "owner").e2e).toEqual([]);
    expect(plan(["apps/web/src/lazy.ts"], "wide").e2e).toEqual(["e2e/Q/playwright.q.config.ts"]);
    expect(plan(["e2e/Q/_stack.ts"], "owner").e2e).toEqual(["e2e/Q/playwright.q.config.ts"]);
    expect(plan(["e2e/Q/_stack.ts"], "none").e2e).toEqual([]);
  });
});

describe("TS1 · chọn test (int, gốc, nén dòng lệnh)", () => {
  const plan = planFor();
  it("int dính tới file đổi qua import và đường dẫn spawn", () => {
    expect(plan(["apps/web/src/lazy.ts"]).int).toEqual(["tests/acceptance/Z/spawn.int.test.ts"]);
    expect(plan(["packages/lib/src/x/deep.ts"]).int).toEqual([
      "tests/acceptance/Z/spawn.int.test.ts",
    ]);
  });

  it("file cấp gốc đổi ⇒ chạy mọi unit + ghi chú; chỉ docs đổi ⇒ không test nào", () => {
    const g = plan([GLOBAL_FILES[0] ?? "package.json"]);
    expect(g.unit).toEqual(["*"]);
    expect(g.notes.join(" ")).toContain("test:all");
    const d = plan(["docs/WORKFLOW.md"]);
    expect([d.unit, d.int, d.e2e, d.typecheck]).toEqual([[], [], [], false]);
  });

  it("compact: danh sách ngắn giữ nguyên, quá dài rút về thư mục", () => {
    expect(compact(["a/x.ts", "a/y.ts"])).toEqual(["a/x.ts", "a/y.ts"]);
    const many = Array.from(
      { length: 400 },
      (_, i) => `tests/acceptance/M${i % 3}/long-file-name-${i}.int.test.ts`,
    );
    expect(compact(many)).toEqual([
      "tests/acceptance/M0/",
      "tests/acceptance/M1/",
      "tests/acceptance/M2/",
    ]);
  });

  it("parseAffectedArgs", () => {
    expect(parseAffectedArgs(["--base=abc", "--dry-run"])).toMatchObject({
      base: "abc",
      dryRun: true,
      e2e: "owner",
    });
    expect(parseAffectedArgs(["--no-e2e"]).e2e).toBe("none");
    expect(parseAffectedArgs(["--e2e=wide"]).e2e).toBe("wide");
    expect(() => parseAffectedArgs(["--e2e=x"])).toThrow();
  });
});

describe("TS1 · test:affected trên chính repo", () => {
  const root = resolve(import.meta.dir, "../../..");

  it("mọi cấu hình e2e có tag riêng (trừ gốc) và mọi file spec e2e có đúng một cấu hình chủ", async () => {
    const configs = await findE2eConfigs(root);
    const infos = configInfos(configs, (c) =>
      require("node:fs").readFileSync(join(root, c), "utf8"),
    );
    expect(infos.filter((i) => !i.tag).map((i) => i.config)).toEqual(["playwright.config.ts"]);
    const tags = infos.map((i) => i.tag).filter(Boolean);
    expect(new Set(tags).size).toBe(tags.length);
    const g = buildGraph(root);
    const specs = [...g.deps.keys()].filter(
      (f) =>
        /^e2e\/(?:[^/]+\/)*[^/]+\.(?:spec|\w+)\.ts$/.test(f) &&
        !/(^|\/)_|support\/|config\.ts$|\.test\.ts$/.test(f),
    );
    const orphan = specs.filter(
      (f) =>
        /\.(spec|pa|pb|pb2|pc|pc2|pd|chat|x2a|x2b|x2b2|n1|n2|k1|cw|studio|x1|combine)\.ts$/.test(
          f,
        ) && !configOfSpec(f, infos),
    );
    expect(orphan).toEqual([]);
  });

  it("đổi migration ⇒ kéo mọi int dùng DB mẫu (qua MIGRATION_SEEDS)", () => {
    const g = buildGraph(root);
    const a = affectedBy(g, MIGRATION_SEEDS);
    expect([...a].filter((f) => f.endsWith(".int.test.ts")).length).toBeGreaterThan(100);
  });

  it("đổi event-router của chat-web: unit của chính nó, e2e chat (chủ), không int", () => {
    const g = buildGraph(root);
    const a = affectedBy(g, ["apps/chat-web/src/features/realtime/event-router.ts"]);
    expect(a.has("apps/chat-web/src/features/realtime/event-router.test.ts")).toBe(true);
    expect([...a].some((f) => f.endsWith(".int.test.ts"))).toBe(false);
  });
});
