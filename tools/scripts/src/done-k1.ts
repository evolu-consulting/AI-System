// K1-AC · HUB-FR-131..134 · `bun run done:k1`: Lệnh xong mốc K1-knowledgehub — đúng `docs/specs/K1-knowledgehub/test-plan.md` §6.
// Tuần tự, dừng ở bước đỏ đầu (cơ chế `runDone`). int + e2e dùng DB test: không chạy song song với bộ khác.
// DB test tag riêng: int = `k1_done` (`.env.test-k1_done.local`), e2e admin+chat = `k1_e2e` (`.env.test-k1_e2e.local`);
// bước `db:test:create` idempotent (tạo DB + migrate nếu chưa có).
// Đỏ đã biết (KHÔNG ẩn, phân loại khi báo cáo): R49 (fixture contracts-h2c, tests/acceptance/H2c/rules/contracts-h2c.test.ts,
// không thuộc K1; chạy ở bước KHÔNG chặn), TECH-DEBT #148 (hub-rls/migrate-hub int).
// Dùng: `bun run done:k1 [--from=<số bước>] [--skip=int,e2e]` (`--skip` bỏ nhóm tốn DB/cổng; KHÔNG phải done đủ).

import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";
import { parseSkip, type Skip } from "./done-x2b";

const BUN = process.execPath;
const INT_ENV = ".env.test-k1_done.local";
const UNIT = [
  "apps/hub-api/src/modules/kh",
  "packages/contracts",
  "tools/mocks",
  "tests/acceptance/K1/rules",
];

const bunStep = (title: string, args: string[], extra: Partial<Step> = {}): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
  ...extra,
});

const intSteps = (): Step[] => [
  bunStep("bun run db:test:create k1_done", ["run", "db:test:create", "k1_done"]),
  bunStep("bun test:int (DB k1_done: K1 + hồi quy H4b-1/P-b2/H2a)", [
    `--env-file=${INT_ENV}`,
    "--config=bunfig.int.toml",
    "test",
    "--timeout",
    "30000",
    ".int.test",
  ]),
];

const pw = (config: string, ...filter: string[]) => [
  "x",
  "playwright",
  "test",
  "-c",
  config,
  ...filter,
];

const e2eSteps = (): Step[] => [
  bunStep(
    "bunx playwright test -c e2e/studio/playwright.config.ts k1-knowledgehub",
    pw("e2e/studio/playwright.config.ts", "k1-knowledgehub"),
  ),
  bunStep("bun run db:test:create k1_e2e", ["run", "db:test:create", "k1_e2e"]),
  bunStep(
    "bunx playwright test -c e2e/K1/playwright.k1.config.ts",
    pw("e2e/K1/playwright.k1.config.ts"),
  ),
];

/** Thứ tự = test-plan §6 (bước 1–6). */
export function k1Steps(skip: Skip = new Set()): Step[] {
  return [
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep(`bun test ${UNIT.join(" ")}`, ["test", ...UNIT]),
    bunStep(
      "bun test contracts-h2c (R49 đỏ cũ, không chặn)",
      ["test", "tests/acceptance/H2c/rules/contracts-h2c.test.ts"],
      { blocking: false },
    ),
    ...(skip.has("int") ? [] : intSteps()),
    ...(skip.has("e2e") ? [] : e2eSteps()),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
  ];
}

export const main = (argv: string[]): Promise<number> =>
  runDone("k1", k1Steps(parseSkip(argv)), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
