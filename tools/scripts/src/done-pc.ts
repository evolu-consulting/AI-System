// P-c-AC · HUB-FR-119 · `bun run done:pc`: Lệnh xong mốc P-c (autofix) — `docs/specs/P-c-autofix/test-plan.md` §7.
// Tuần tự, dừng ở bước đỏ đầu (cơ chế `runDone`); tiếp bằng `--from=<số bước>`. int + e2e dùng DB test: không chạy song song với bộ khác.
// DB test: int = `pc_done` (`.env.test-pc_done.local`); e2e = `pc_e2e` (`.env.test-pc_e2e.local`); Runtime pytest dùng DB H1.
// Bước 6 (`test:pc:sandbox`) cần Docker/Podman + ảnh `RUNTIME_SANDBOX_IMAGE` (đỏ có thông báo nếu thiếu, không skip).

import type { Step } from "./done-h1";
import { pyDbUrl } from "./done-h1";
import { runDone } from "./done-h2a";

const BUN = process.execPath;
const INT_ENV = ".env.test-pc_done.local";
const H1_DB = "ai_system_h1_test";

const bunStep = (title: string, args: string[]): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
});

/** Lệnh Runtime: export DB test → uv sync → pytest P-c (đơn vị + int đầu-cuối AF01–AF11). */
export function pcRuntimeCommand(
  env: Record<string, string | undefined> = process.env,
  platform = process.platform,
): string {
  const owner = env.HUB_TEST_DATABASE_URL || `postgres://ai:ai_dev_pw@localhost:5432/${H1_DB}`;
  const rt =
    env.AGENT_RT_TEST_DATABASE_URL ||
    `postgres://agent_runtime:agent_runtime_dev_pw@localhost:5432/${H1_DB}`;
  return [
    `export HUB_TEST_DATABASE_URL='${pyDbUrl(owner, platform)}' AGENT_RT_TEST_DATABASE_URL='${pyDbUrl(rt, platform)}'`,
    "(uv sync --frozen 2>/dev/null || uv sync) >/dev/null 2>&1",
    "uv run pytest tests/acceptance/pc -q && uv run pytest -m int tests/acceptance/pc/autofix_int_test.py -q",
  ].join("; ");
}

/** Thứ tự = test-plan §7 (bước 1–9). */
export function pcSteps(env: Record<string, string | undefined> = process.env): Step[] {
  return [
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep("bun test", ["test"]),
    bunStep("bun run db:test:create pc_done", ["run", "db:test:create", "pc_done"]),
    bunStep("bun test:int (DB pc_done)", [
      `--env-file=${INT_ENV}`,
      "--config=bunfig.int.toml",
      "test",
      "--timeout",
      "30000",
      ".int.test",
    ]),
    bunStep("Runtime pytest pc + -m int autofix_int_test.py", [
      "apps/agent-runtime/scripts/run.ts",
      pcRuntimeCommand(env),
    ]),
    bunStep("bun run test:pc:sandbox", ["run", "test:pc:sandbox"]),
    bunStep("bun run db:test:create pc_e2e", ["run", "db:test:create", "pc_e2e"]),
    bunStep("bunx playwright test -c e2e/P-c/playwright.pc.config.ts", [
      "x",
      "playwright",
      "test",
      "-c",
      "e2e/P-c/playwright.pc.config.ts",
      "--reporter=line",
    ]),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
  ];
}

export const main = (argv: string[]): Promise<number> => runDone("pc", pcSteps(), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
