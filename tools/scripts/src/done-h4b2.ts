// H4b2-AC · HUB-FR-66, HUB-FR-67, HUB-FR-77, HUB-FR-78 · `bun run done:h4b2` (alias `done:h4b`): Lệnh xong mốc H4b2-models — `docs/specs/H4b2-models/test-plan.md` §6.
// Tuần tự, dừng ở bước đỏ đầu (cơ chế `runDone`). int + e2e dùng DB test: không chạy song song với bộ khác.
// DB test tag riêng: int + e2e studio = `h4b2_done` (`.env.test-h4b2_done.local`); `db:test:create` idempotent (tạo DB + migrate nếu chưa có).
// Dùng: `bun run done:h4b2 [--from=<số bước>] [--skip=int,e2e]` (`--skip` bỏ nhóm tốn DB/cổng; KHÔNG phải done đủ).

import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";
import { parseSkip, type Skip } from "./done-x2b";

const BUN = process.execPath;
const INT_ENV = ".env.test-h4b2_done.local";

const bunStep = (title: string, args: string[], extra: Partial<Step> = {}): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
  ...extra,
});

const intSteps = (): Step[] => [
  bunStep("bun run db:test:create h4b2_done", ["run", "db:test:create", "h4b2_done"]),
  bunStep("bun test:int (DB h4b2_done: H4b2 + hồi quy H4a/H4b1/H3b/H1)", [
    `--env-file=${INT_ENV}`,
    "--config=bunfig.int.toml",
    "test",
    "--timeout",
    "30000",
    ".int.test",
  ]),
];

const e2eSteps = (): Step[] => [
  bunStep("bunx playwright test -c e2e/studio/playwright.config.ts h4b2", [
    "x",
    "playwright",
    "test",
    "-c",
    "e2e/studio/playwright.config.ts",
    "h4b2",
  ]),
];

/** Thứ tự = test-plan §6 (bước 1–6). */
export function h4b2Steps(skip: Skip = new Set()): Step[] {
  return [
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep("bun test", ["test"]),
    ...(skip.has("int") ? [] : intSteps()),
    ...(skip.has("e2e") ? [] : e2eSteps()),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
  ];
}

export const main = (argv: string[]): Promise<number> =>
  runDone("h4b2", h4b2Steps(parseSkip(argv)), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
