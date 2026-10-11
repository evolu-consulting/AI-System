// P-b-AC · HUB-FR-120…125, ADM-FR-68/69, WRK-FR-27 · `bun run done:pb`: Lệnh xong mốc P-b (nguồn tri thức, CR-060) — theo
// `docs/specs/P-b-sources/test-plan.md` §8. Dừng ở bước đỏ đầu; cơ chế `runDone`. Bước dùng DB/cổng chạy tuần tự.
// Mọi bước dùng provider GIẢ (Runtime giả/fake-cli); smoke Claude thật (PF-S5) là bước UAT riêng, KHÔNG nằm ở đây.
// Dùng: `bun run done:pb [--from=<số bước>] [--skip=int,e2e]` (`--skip` bỏ nhóm bước tốn DB/cổng/container; KHÔNG phải done đủ).
// pfs2 (stack) tự dựng container Runtime Linux qua Docker (`bootPb`) ⇒ cần Docker; pytest Python không chạy native Windows.

import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";
import { parseSkip, type Skip } from "./done-x2b";

const BUN = process.execPath;

const bunStep = (title: string, args: string[], extra: Partial<Step> = {}): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
  ...extra,
});

/** DB test riêng mỗi lát (`.env.test-<tag>.local`); `db:test:create` idempotent (tạo nếu thiếu + migrate). */
const dbCreate = (tag: string): Step =>
  bunStep(`bun run db:test:create ${tag}`, ["run", "db:test:create", tag]);

const intSlice = (tag: string, dir: string): Step[] => [
  dbCreate(tag),
  bunStep(
    `bun --env-file=.env.test-${tag}.local --config=bunfig.int.toml test tests/acceptance/P-b/${dir}`,
    [
      `--env-file=.env.test-${tag}.local`,
      "--config=bunfig.int.toml",
      "test",
      "--timeout",
      "60000",
      `tests/acceptance/P-b/${dir}`,
    ],
  ),
];

/** pfs1 gồm cả rules (bun test thường); int chạy qua bunfig.int.toml. */
const intSteps = (): Step[] => [
  bunStep("bun test tests/acceptance/P-b (rules/unit, bunfig bỏ *.int.test.ts)", [
    "test",
    "tests/acceptance/P-b",
  ]),
  ...intSlice("pb_pfs1", "pfs1"),
  ...intSlice("pb_pfs3", "pfs3"),
  ...intSlice("pb_pfs4", "pfs4"),
];

const stackSteps = (): Step[] => [
  bunStep("bun run test:pb:stack (pfs2, Runtime container)", ["run", "test:pb:stack"]),
];

/** Xoá schema DB e2e P-b để e2e chạy trên DB sạch (DB `pb_e2e` — giống DROP_E2E_DB của done-pa). */
const DROP_E2E_DB = `import postgres from "postgres";
const url = process.env.TEST_DATABASE_URL;
if (!url || !url.endsWith("_test")) throw new Error("TEST_DATABASE_URL phải kết thúc _test");
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql\`DROP SCHEMA IF EXISTS admin, hub, drizzle CASCADE\`;
await sql.end();`;

const e2eSteps = (): Step[] => [
  dbCreate("pb_e2e"),
  bunStep("DROP SCHEMA admin,hub,drizzle (DB e2e P-b, .env.test-pb_e2e.local)", [
    "--env-file=.env.test-pb_e2e.local",
    "-e",
    DROP_E2E_DB,
  ]),
  bunStep("bunx playwright test -c e2e/P-b/playwright.pb.config.ts --reporter=line", [
    "x",
    "playwright",
    "test",
    "-c",
    "e2e/P-b/playwright.pb.config.ts",
    "--reporter=line",
  ]),
];

/** Thứ tự: tĩnh · contract · unit/rules · int · stack · e2e · khoá/trace. */
export function pbSteps(skip: Skip = new Set()): Step[] {
  return [
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep("bun run contracts:check", ["run", "contracts:check"]),
    bunStep("bun run check", ["run", "check"]),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
    ...(skip.has("int") ? [] : intSteps()),
    ...(skip.has("int") ? [] : stackSteps()),
    ...(skip.has("e2e") ? [] : e2eSteps()),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
  ];
}

export const main = (argv: string[]): Promise<number> =>
  runDone("pb", pbSteps(parseSkip(argv)), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
