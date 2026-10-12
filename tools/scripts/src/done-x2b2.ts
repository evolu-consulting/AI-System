// X2b2-AC · HUB-FR-44, HUB-FR-101 · `bun run done:x2b2`: Lệnh xong mốc X2b2-room-attachments — đúng `docs/specs/X2b2-room-attachments/tasks.md` "Lệnh mốc done:x2b2" (bước 1–9; bước 10 done:h2c/done:pa chạy ngoài script).
// Dừng ở bước đỏ đầu. Bước dùng DB/cổng chạy tuần tự (int + e2e dùng DB test: không chạy song song với bộ khác). Cơ chế `runDone`.
// `check:fn` chỉ quét file .ts/.tsx X2b2 đổi từ commit Gate (`--all` đỏ vì nợ cũ ngoài mốc, xem done-x2a).
// Dùng: `bun run done:x2b2 [--from=<số bước>] [--skip=int,e2e]` (`--skip` bỏ nhóm bước tốn DB/cổng; kết quả KHÔNG phải done đủ).

import { AUTH_URL, HUB_URL } from "../../hub-dev/src/dev";
import { contractUsersJson } from "../../hub-dev/src/fixture";
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

/** Commit Gate X2b2: `check:fn` chỉ quét file .ts/.tsx đổi từ đây (kể cả chưa commit). */
export const X2B2_BASE = "3b14f1f5";

const SCOPE = ["apps/hub-api", "apps/chat-web/src", "packages/contracts/src", "packages/db/src"];

/** File .ts/.tsx X2b2 thêm/sửa trong phạm vi mốc (`git diff --name-only <base> -- <scope>`, bỏ file đã xoá). */
export function scopedFiles(base = X2B2_BASE): string[] {
  const p = Bun.spawnSync(["git", "diff", "--name-only", "--diff-filter=d", base, "--", ...SCOPE], {
    stdout: "pipe",
  });
  return p.stdout
    .toString()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\.tsx?$/.test(l));
}

const INT_FLAGS = [
  "--env-file=.env.local",
  "--config=bunfig.int.toml",
  "test",
  "--timeout",
  "40000",
];
const REGRESSION =
  "tests/acceptance/H2c/ tests/acceptance/X2b/ tests/acceptance/X2a/ tests/acceptance/P-a/ tests/acceptance/H1/ tests/acceptance/C1/";

const intSteps = (): Step[] => [
  bunStep("bun run db:migrate (lần 1)", ["run", "db:migrate"]),
  bunStep("bun run db:migrate (lần 2 — idempotent 0023)", ["run", "db:migrate"]),
  bunStep("bun --config=bunfig.int.toml test packages/db/src/hub-x2b2.int.test.ts", [
    "--env-file=.env.local",
    "--config=bunfig.int.toml",
    "test",
    "--timeout",
    "40000",
    "packages/db/src/hub-x2b2.int.test.ts",
  ]),
  bunStep("bun … test tests/acceptance/X2b2/", [...INT_FLAGS, "tests/acceptance/X2b2/"]),
  bunStep(`bun … test ${REGRESSION}`, [...INT_FLAGS, ...REGRESSION.split(" ")]),
];

const e2eSteps = (): Step[] => [
  bunStep("bun run e2e:chat:x2b2", ["run", "e2e:chat:x2b2"]),
  bunStep("bun run e2e:chat:x2b", ["run", "e2e:chat:x2b"]),
  bunStep("bun run e2e:chat:x2a", ["run", "e2e:chat:x2a"]),
  bunStep("bunx playwright test -c e2e/chat/playwright.config.ts x1-attachments", [
    "x",
    "playwright",
    "test",
    "-c",
    "e2e/chat/playwright.config.ts",
    "x1-attachments",
  ]),
];

/** Thứ tự = tasks.md "Lệnh mốc done:x2b2" bước 1–9. */
export function x2b2Steps(files: string[] = scopedFiles(), skip: Skip = new Set()): Step[] {
  const unit =
    "apps/hub-api apps/chat-web packages/contracts packages/db tests/acceptance/X2b2/rules tests/acceptance/X2b/rules";
  return [
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep("bunx biome ci --changed --no-errors-on-unmatched", [
      "x",
      "biome",
      "ci",
      "--changed",
      "--no-errors-on-unmatched",
    ]),
    bunStep(`bun test ${unit}`, ["test", ...unit.split(" ")]),
    ...(skip.has("int") ? [] : intSteps()),
    ...(skip.has("e2e") ? [] : e2eSteps()),
    bunStep("bunx depcruise apps/hub-api apps/chat-web/src packages/contracts/src", [
      "x",
      "depcruise",
      "apps/hub-api",
      "apps/chat-web/src",
      "packages/contracts/src",
    ]),
    bunStep("bun run check:fn --files <phạm vi X2b2>", ["run", "check:fn", "--files", ...files]),
    bunStep("bun run check:size --all", ["run", "check:size", "--all"]),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
    bunStep("bun run i18n:check", ["run", "i18n:check"]),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
    // Cuối: hub-dev (needsDev) giữ :3001/:4000 tới hết runDone.
    bunStep(
      `HUB_URL=${HUB_URL} AUTH_URL=${AUTH_URL} CHAT_CONTRACT_USERS='<json>' bun run test:contract:chat`,
      ["run", "test:contract:chat"],
      { env: { HUB_URL, AUTH_URL, CHAT_CONTRACT_USERS: contractUsersJson() }, needsDev: true },
    ),
  ];
}

export const main = (argv: string[]): Promise<number> =>
  runDone("x2b2", x2b2Steps(scopedFiles(), parseSkip(argv)), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
