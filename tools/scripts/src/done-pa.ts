// P-a-AC · HUB-FR-104…117, ADM-FR-65…67 · `bun run done:pa`: Lệnh xong mốc P-a (process engine) — đúng `docs/specs/P-process-engine/test-plan.md` §6.
// Dừng ở bước đỏ đầu. Bước dùng DB/cổng chạy tuần tự (int + e2e dùng DB test: không chạy song song với bộ khác). Cơ chế `runDone`.
// Bước 9 (`test:perf`) không chặn mốc ⇒ không nằm trong lệnh này.
// Dùng: `bun run done:pa [--from=<số bước>] [--skip=int,e2e]` (`--skip` bỏ nhóm bước tốn DB/cổng; kết quả KHÔNG phải done đủ).

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
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

const INT_BASE = [
  "--env-file=.env.local",
  "--config=bunfig.int.toml",
  "test",
  "--timeout",
  "40000",
];
const PA_DIRS = ["step0", "pf1", "pf2", "pf3", "pf4", "scenario"].map(
  (d) => `tests/acceptance/P-a/${d}`,
);
const OLD_INT = ["H1", "H2b", "C1", "X2a", "X2b"].map((d) => `tests/acceptance/${d}`);

/** Bước 3–5 (lock-order P1-48/P2-14 và migration 0019 nằm trong pf1/step0 nên bước 3 đã phủ). */
const intSteps = (): Step[] => [
  bunStep(`bun ${INT_BASE.join(" ")} ${PA_DIRS.join(" ")}`, [...INT_BASE, ...PA_DIRS]),
  ...(["off", "on"] as const).map((flag) =>
    bunStep(
      `HUB_PROCESS_ENGINE=${flag} bun …test ${OLD_INT.join(" ")}`,
      [...INT_BASE, ...OLD_INT],
      {
        env: { HUB_PROCESS_ENGINE: flag },
      },
    ),
  ),
];

/** Xoá schema DB e2e P-a (giống `resetTestDb`) để e2e luôn chạy trên DB sạch. */
const DROP_E2E_DB = `import postgres from "postgres";
const url = process.env.TEST_DATABASE_URL;
if (!url || !url.endsWith("_test")) throw new Error("TEST_DATABASE_URL phải kết thúc _test");
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql\`DROP SCHEMA IF EXISTS admin, hub, drizzle CASCADE\`;
await sql.end();`;

/** Biến của `.env.test-pa_e2e.local` (DB e2e riêng). Parent chạy `--env-file=.env.local` nên phải đặt tường minh: loadEnvFile/--env-file không ghi đè biến đã có. */
function e2eEnv(): Record<string, string> {
  return parseEnv(readFileSync(".env.test-pa_e2e.local", "utf8")) as Record<string, string>;
}

const e2eSteps = (): Step[] => [
  bunStep("DROP SCHEMA admin,hub,drizzle (DB e2e P-a, .env.test-pa_e2e.local)", [
    "--env-file=.env.test-pa_e2e.local",
    "-e",
    DROP_E2E_DB,
  ]),
  bunStep(
    "bunx playwright test -c e2e/P-a/playwright.pa.config.ts --reporter=line",
    ["x", "playwright", "test", "-c", "e2e/P-a/playwright.pa.config.ts", "--reporter=line"],
    { env: e2eEnv() },
  ),
  bunStep("bun run e2e:chat:x2a", ["run", "e2e:chat:x2a"], { env: { HUB_PROCESS_ENGINE: "off" } }),
  bunStep("bun run e2e:chat:x2b", ["run", "e2e:chat:x2b"], { env: { HUB_PROCESS_ENGINE: "off" } }),
];

/** Thứ tự = test-plan §6 (tĩnh · unit/rules · int · e2e · khoá/trace). */
export function paSteps(skip: Skip = new Set()): Step[] {
  return [
    bunStep("bun run check", ["run", "check"]),
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep("bun test packages/contracts", ["test", "packages/contracts"]),
    bunStep("bun test tests/acceptance/P-a (bunfig bỏ *.int.test.ts)", [
      "test",
      "tests/acceptance/P-a",
    ]),
    ...(skip.has("int") ? [] : intSteps()),
    ...(skip.has("e2e") ? [] : e2eSteps()),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
  ];
}

export const main = (argv: string[]): Promise<number> =>
  runDone("pa", paSteps(parseSkip(argv)), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
