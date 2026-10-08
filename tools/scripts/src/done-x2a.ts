// X2a-AC · HUB-FR-96…102 · `bun run done:x2a`: Lệnh xong mốc X2a-rooms — đúng `docs/specs/X2a-rooms/test-plan.md` §8 + tasks I1.
// Dừng ở bước đỏ đầu. Bước dùng DB/cổng/`apps/*/dist` chạy tuần tự. Cơ chế dùng chung `runDone`.
// `check:fn` chỉ quét file thuộc phạm vi X2a (`--all` đỏ vì nợ cũ H2a/H2b ngoài mốc: agents.test, commands.test, hub-h2b.int, combine.test, done-h2b.test…).
// Dùng: `bun run done:x2a [--from=<số bước>]`.

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

/** Thư mục/file chứa code + test X2a (check:fn chỉ quét các file git theo dõi dưới đây). */
export const X2A_FN_SCOPE = [
  "apps/hub-api/src/modules/rooms",
  "apps/hub-api/src/modules/me-stream",
  "apps/hub-api/src/modules/directory",
  "apps/hub-api/src/lib",
  "apps/chat-web/src/features",
  "packages/contracts/src/chat/directory.ts",
  "packages/contracts/src/chat/me-stream.ts",
  "packages/contracts/src/chat/rooms.ts",
  "packages/contracts/src/chat/events.ts",
  "packages/contracts/src/chat/errors.ts",
  "packages/contracts/src/chat/entities.ts",
  "tools/mocks/src/chat",
  "tools/hub-dev/src",
  "tests/acceptance/X2a",
  "e2e/chat",
  "tools/scripts/src/done-x2a.ts",
];

function scopedFiles(): string[] {
  const p = Bun.spawnSync(["git", "ls-files", "--", ...X2A_FN_SCOPE], { stdout: "pipe" });
  return p.stdout
    .toString()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Thứ tự = test-plan §8 + tasks I1 (unit · int · contract · e2e · tĩnh · build/bundle). */
export function x2aSteps(files: string[] = scopedFiles()): Step[] {
  const unit =
    "apps/hub-api apps/chat-web tools/hub-dev packages/contracts tests/acceptance/X2a/rules";
  const int = "tests/acceptance/X2a/ tests/acceptance/H1/";
  const bundle = (pkg: string): Step[] => [
    bunStep(`bun run --filter @ai/${pkg} build`, ["run", "--filter", `@ai/${pkg}`, "build"]),
    bunStep(`bun run --filter @ai/${pkg} check:bundle`, [
      "run",
      "--filter",
      `@ai/${pkg}`,
      "check:bundle",
    ]),
  ];
  return [
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep(`bun test ${unit}`, ["test", ...unit.split(" ")]),
    bunStep(`bun --env-file=.env.local --config=bunfig.int.toml test --timeout 40000 ${int}`, [
      "--env-file=.env.local",
      "--config=bunfig.int.toml",
      "test",
      "--timeout",
      "40000",
      ...int.split(" "),
    ]),
    bunStep("bun run e2e:chat", ["run", "e2e:chat"]),
    bunStep("bun run e2e:chat:x2a", ["run", "e2e:chat:x2a"]),
    ...bundle("chat-web"),
    bunStep("bunx depcruise apps/hub-api apps/chat-web/src tools/hub-dev packages/contracts/src", [
      "x",
      "depcruise",
      "apps/hub-api",
      "apps/chat-web/src",
      "tools/hub-dev",
      "packages/contracts/src",
    ]),
    bunStep("bun run check:fn --files <phạm vi X2a>", ["run", "check:fn", "--files", ...files]),
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

export const main = (argv: string[]): Promise<number> => runDone("x2a", x2aSteps(), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
