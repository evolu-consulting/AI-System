// P-c2-pr · HUB-FR-129 · `bun run done:pc2`: Lệnh xong mốc P-c2 (push nhánh + PR / rebase) — `docs/specs/P-c2-pr/test-plan.md` §7.
// Tuần tự, dừng ở bước đỏ đầu (cơ chế `runDone`); tiếp bằng `--from=<số bước>`. int + e2e dùng DB test: không chạy song song với bộ khác.
// DB test: int = `pc2_done` (`.env.test-pc2_done.local`); e2e = `pc2_e2e` (`.env.test-pc2_e2e.local`); Runtime pytest dùng DB H1 (drop+create để có 0032, G15).
// KHÔNG chạy `bun test` trần / `test:int` toàn bộ: chỉ thư mục/ca của mốc (loại đỏ-sẵn không do P-c2: hub-rls.int:185 TD#176, H2c R48/R49).
// Bước sandbox (`test:pc:sandbox`) cần Linux + Docker/Podman + ảnh `RUNTIME_SANDBOX_IMAGE` (đỏ có thông báo nếu thiếu, không skip).

import { readdirSync } from "node:fs";
import type { Step } from "./done-h1";
import { pyDbUrl } from "./done-h1";
import { runDone } from "./done-h2a";

const BUN = process.execPath;
const INT_ENV = ".env.test-pc2_done.local";
const H1_DB = "ai_system_h1_test";
const INT_DIR = "tests/acceptance/P-c2";

const bunStep = (title: string, args: string[]): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
});

const intArgs = (...files: string[]): string[] => [
  `--env-file=${INT_ENV}`,
  "--config=bunfig.int.toml",
  "test",
  "--timeout",
  "60000",
  ...files,
];

/** Các file `*.int.test.ts` của P-c2 (mỗi file chạy riêng). */
export function pc2IntFiles(dir = INT_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".int.test.ts"))
    .sort()
    .map((f) => `${dir}/${f}`);
}

/** Lệnh Runtime: export DB test → uv sync → pytest pc2 + pc → -m int apply_int_test.py. */
export function pc2RuntimeCommand(
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
    "uv run pytest tests/acceptance/pc2 tests/acceptance/pc -q && uv run pytest -m int tests/acceptance/pc2/apply_int_test.py -q",
  ].join("; ");
}

/** Thứ tự = test-plan §7. */
export function pc2Steps(env: Record<string, string | undefined> = process.env): Step[] {
  const pw = (cfg: string): string[] => ["x", "playwright", "test", "-c", cfg, "--reporter=line"];
  return [
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep("bun test (contracts + processes + P-c2/rules + mocks)", [
      "test",
      "packages/contracts",
      "apps/hub-api/src/modules/processes",
      "tests/acceptance/P-c2/rules",
      "tools/mocks",
    ]),
    bunStep("bun run db:test:create pc2_done", ["run", "db:test:create", "pc2_done"]),
    ...pc2IntFiles().map((f) => bunStep(`int P-c2: ${f.split("/").pop()}`, intArgs(f))),
    bunStep(
      "int hồi quy P-a P-b P-c H4b1",
      intArgs(
        "tests/acceptance/P-a",
        "tests/acceptance/P-b",
        "tests/acceptance/P-c",
        "tests/acceptance/H4b1",
      ),
    ),
    bunStep("bun run db:test:drop h1", ["run", "db:test:drop", "h1"]),
    bunStep("bun run db:test:create h1", ["run", "db:test:create", "h1"]),
    bunStep("Runtime pytest pc2 + pc + -m int apply_int_test.py", [
      "apps/agent-runtime/scripts/run.ts",
      pc2RuntimeCommand(env),
    ]),
    bunStep("bun run test:pc:sandbox", ["run", "test:pc:sandbox"]),
    bunStep("bun run db:test:create pc2_e2e", ["run", "db:test:create", "pc2_e2e"]),
    bunStep("playwright P-c2", pw("e2e/P-c2/playwright.pc2.config.ts")),
    bunStep("playwright hồi quy P-c", pw("e2e/P-c/playwright.pc.config.ts")),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
  ];
}

export const main = (argv: string[]): Promise<number> => runDone("pc2", pc2Steps(), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
