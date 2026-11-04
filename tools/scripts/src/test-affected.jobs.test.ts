// test:affected · diff → bao đóng ngược → việc e2e (job) / gói typecheck / JSON / tham số (fixture tạm, không đọc repo thật).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { affectedBy, buildGraph } from "./lib/import-graph";
import {
  configInfos,
  jobOfConfig,
  parseAffectedArgs,
  planAffected,
  planToJson,
  typecheckPackages,
} from "./test-affected.rules";

let dir: string;
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

const CONFIGS = [
  "playwright.config.ts",
  "e2e/chat/playwright.config.ts",
  "e2e/chat/playwright.x2a.config.ts",
  "e2e/community-web/playwright.config.ts",
  "e2e/community-web/playwright.stack.config.ts",
  "e2e/contracts-web/playwright.config.ts",
  "e2e/N1/playwright.config.ts",
  "e2e/P-a/playwright.pa.config.ts",
  "e2e/combine/playwright.config.ts",
];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "affected-jobs-"));
  put(
    "packages/contracts/package.json",
    JSON.stringify({ name: "@ai/contracts", exports: "./src/index.ts" }),
  );
  put("packages/contracts/src/index.ts", "export const c = 1;");
  put(
    "packages/other/package.json",
    JSON.stringify({ name: "@ai/other", exports: "./src/index.ts" }),
  );
  put("packages/other/src/index.ts", "export const o = 1;");
  put("apps/chat-web/src/a.ts", 'import { c } from "@ai/contracts"; export { c };');
  put("apps/chat-web/src/a.test.ts", 'import "./a";');
  put("apps/sohoptac-web/src/modules/community/b.ts", "export const b = 1;");
  put("apps/admin-web/src/features/processes/p.ts", "export const p = 1;");
  put("apps/hub-api/src/modules/other/r.ts", "export const r = 1;");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const infos = configInfos(CONFIGS, () => "export default {}");

/** Kế hoạch (chế độ owner) cho danh sách file đổi trên đồ thị fixture. */
function plan(changed: string[]) {
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
    opts: { e2e: "owner" },
  });
}

describe("test:affected · ánh xạ diff → việc e2e", () => {
  it("jobOfConfig: tên việc test:e2e:par của từng cấu hình", () => {
    expect(CONFIGS.map(jobOfConfig)).toEqual([
      "root",
      "chat",
      "chat-x2a",
      "community-web",
      "community-web-stack",
      "contracts-web",
      "N1",
      "P-a",
      "combine",
    ]);
  });

  it("chat-web → mọi việc chat*; unit của chính nó; gói apps/chat-web + packages/contracts", () => {
    const p = plan(["apps/chat-web/src/a.ts"]);
    expect(p.jobs).toEqual(["chat", "chat-x2a"]);
    expect(p.unit).toEqual(["apps/chat-web/src/a.test.ts"]);
    expect(p.typecheckPackages).toEqual(["apps/chat-web"]);
  });

  it("module community (sohoptac-web) → community-web + community-web-stack + contracts-web + N1", () => {
    expect(plan(["apps/sohoptac-web/src/modules/community/b.ts"]).jobs).toEqual([
      "N1",
      "community-web",
      "community-web-stack",
      "contracts-web",
    ]);
  });

  it("thư viện quy trình (admin-web processes) → root (admin) + P-a", () => {
    expect(plan(["apps/admin-web/src/features/processes/p.ts"]).jobs).toEqual(["P-a", "root"]);
  });

  it("packages/contracts đổi ⇒ việc của app import nó (qua đồ thị), không app khác", () => {
    const p = plan(["packages/contracts/src/index.ts"]);
    expect(p.jobs).toEqual(["chat", "chat-x2a"]);
    expect(p.typecheckPackages).toEqual(["apps/chat-web", "packages/contracts"]);
  });

  it("hub-api → combine; gói không ai import → không việc nào; docs → rỗng", () => {
    expect(plan(["apps/hub-api/src/modules/other/r.ts"]).jobs).toEqual(["combine"]);
    expect(plan(["packages/other/src/index.ts"]).jobs).toEqual([]);
    expect(plan(["docs/WORKFLOW.md"]).jobs).toEqual([]);
  });

  it("e2e sửa trực tiếp ⇒ việc của cấu hình sở hữu spec", () => {
    expect(plan(["e2e/N1/playwright.config.ts"]).jobs).toEqual(["N1"]);
  });
});

describe("test:affected · typecheckPackages, JSON, tham số", () => {
  it("typecheckPackages: chỉ mã (không test, không md), theo thư mục gói", () => {
    expect(
      typecheckPackages([
        "apps/a/src/x.ts",
        "apps/a/src/x.test.ts",
        "packages/b/src/y.tsx",
        "tools/scripts/src/z.ts",
        "apps/c/README.md",
        "tests/acceptance/q.ts",
      ]),
    ).toEqual(["apps/a", "packages/b", "tools/scripts"]);
  });

  it("planToJson: cấu trúc ổn định", () => {
    const j = planToJson("abc", plan(["apps/sohoptac-web/src/modules/community/b.ts"])) as Record<
      string,
      unknown
    >;
    expect(Object.keys(j)).toEqual([
      "base",
      "changed",
      "affected",
      "unit",
      "int",
      "e2e",
      "typecheck",
      "python",
      "externalSkipped",
      "notes",
    ]);
    expect(j.e2e).toEqual({
      configs: [
        "e2e/N1/playwright.config.ts",
        "e2e/community-web/playwright.config.ts",
        "e2e/community-web/playwright.stack.config.ts",
        "e2e/contracts-web/playwright.config.ts",
      ],
      jobs: ["N1", "community-web", "community-web-stack", "contracts-web"],
    });
    expect(j.typecheck).toEqual({ turbo: true, packages: ["apps/sohoptac-web"], tests: false });
  });

  it("parseAffectedArgs: --base <ref> / --base=<ref>, --json, --run, quarantine mặc định bật", () => {
    expect(parseAffectedArgs(["--base", "2f94a89e", "--json"])).toMatchObject({
      base: "2f94a89e",
      json: true,
      run: "none",
      quarantine: true,
      frozen: false,
    });
    expect(parseAffectedArgs(["--base=x", "--run", "server"])).toMatchObject({
      base: "x",
      run: "server",
    });
    expect(parseAffectedArgs(["--run=local", "--no-quarantine", "--frozen"])).toMatchObject({
      run: "local",
      quarantine: false,
      frozen: true,
    });
    expect(parseAffectedArgs(["--run", "local", "--dry-run"]).run).toBe("none");
    expect(parseAffectedArgs(["--base", "--json"]).base).toBeUndefined();
    expect(() => parseAffectedArgs(["--run", "nope"])).toThrow();
  });
});
