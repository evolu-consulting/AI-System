// X2b-AC · HUB-FR-101, HUB-FR-103 · `bun run done:x2b`: Lệnh xong mốc X2b-room-agents — đúng `docs/specs/X2b-room-agents/test-plan.md` §8.
// Dừng ở bước đỏ đầu. Bước dùng DB/cổng chạy tuần tự (int + e2e dùng DB test: không chạy song song với bộ khác). Cơ chế `runDone`.
// `check:fn` chỉ quét file .ts/.tsx X2b đổi từ commit Gate (`--all` đỏ vì nợ cũ ngoài mốc, xem done-x2a).
// Dùng: `bun run done:x2b [--from=<số bước>] [--skip=int,e2e]` (`--skip` bỏ nhóm bước tốn DB/cổng; kết quả KHÔNG phải done đủ).

import { AUTH_URL, HUB_URL } from "../../hub-dev/src/dev";
import { contractUsersJson } from "../../hub-dev/src/fixture";
import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";

const BUN = process.execPath;

const bunStep = (title: string, args: string[], extra: Partial<Step> = {}): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
  ...extra,
});

/** Commit Gate X2b: `check:fn` chỉ quét file .ts/.tsx X2b đổi từ đây (kể cả chưa commit), không quét feature cũ. */
export const X2B_BASE = "8947b4c";

/** File .ts/.tsx X2b thêm/sửa (`git diff --name-only <base>`, bỏ file đã xoá). */
export function scopedFiles(base = X2B_BASE): string[] {
  const p = Bun.spawnSync(["git", "diff", "--name-only", "--diff-filter=d", base], {
    stdout: "pipe",
  });
  return p.stdout
    .toString()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\.tsx?$/.test(l));
}

export type Skip = ReadonlySet<"int" | "e2e">;

/** `--skip=int,e2e` → nhóm bị bỏ (giá trị lạ bị lờ). */
export function parseSkip(argv: string[]): Skip {
  const raw = argv.find((a) => a.startsWith("--skip="))?.slice(7) ?? "";
  const out = new Set<"int" | "e2e">();
  for (const k of raw.split(",")) if (k === "int" || k === "e2e") out.add(k);
  return out;
}

const INT = "tests/acceptance/X2b/ tests/acceptance/X2a/ tests/acceptance/H1/ tests/acceptance/C1/";

const intSteps = (): Step[] => [
  bunStep(`bun --env-file=.env.local --config=bunfig.int.toml test --timeout 40000 ${INT}`, [
    "--env-file=.env.local",
    "--config=bunfig.int.toml",
    "test",
    "--timeout",
    "40000",
    ...INT.split(" "),
  ]),
];

const e2eSteps = (): Step[] => [
  bunStep("bun run e2e:chat:x2b", ["run", "e2e:chat:x2b"]),
  bunStep("bun run e2e:chat:x2a", ["run", "e2e:chat:x2a"]),
];

/** Thứ tự = test-plan §8 (tĩnh · unit · rules · int · e2e · contract chat). */
export function x2bSteps(files: string[] = scopedFiles(), skip: Skip = new Set()): Step[] {
  const unit = "apps/hub-api tools/hub-dev packages/contracts tests/acceptance/X2b/rules";
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
    bunStep("bunx depcruise apps/hub-api apps/chat-web/src tools/hub-dev packages/contracts/src", [
      "x",
      "depcruise",
      "apps/hub-api",
      "apps/chat-web/src",
      "tools/hub-dev",
      "packages/contracts/src",
    ]),
    bunStep("bun run check:fn --files <phạm vi X2b>", ["run", "check:fn", "--files", ...files]),
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
  runDone("x2b", x2bSteps(scopedFiles(), parseSkip(argv)), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
