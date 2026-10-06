// X1-AC · `bun run done:x1`: Lệnh xong mốc X1-combine — đúng `docs/specs/X1-combine/test-plan.md` §5 (12 bước).
// Không có: Dify thật, WSL, `claude-sub`, `test:perf` (X1-R15). Bước 6–9, 11 tuần tự (chung `apps/admin-web/dist`, cổng).
// Cơ chế dùng chung `runDone`. Dùng: `bun run done:x1 [--from=<số bước>]`.

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

const pw = (cfg?: string): string[] => ["x", "playwright", "test", ...(cfg ? ["-c", cfg] : [])];

/** Thứ tự = §5 test-plan; mỗi dòng `&&` tách thành từng bước (đỏ đầu tiên thì dừng). */
export function x1Steps(): Step[] {
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
    bunStep("bun test", ["test"]),
    bunStep("bun run test:int", ["run", "test:int"]),
    bunStep("bun run test:h2a:stack", ["run", "test:h2a:stack"]),
    bunStep("bun run test:h2b:stack", ["run", "test:h2b:stack"]),
    bunStep("bun run e2e:chat", ["run", "e2e:chat"]),
    bunStep("bunx playwright test", pw()),
    bunStep(
      "bunx playwright test -c e2e/x1/playwright.config.ts",
      pw("e2e/x1/playwright.config.ts"),
    ),
    bunStep(
      "bunx playwright test -c e2e/combine/playwright.config.ts",
      pw("e2e/combine/playwright.config.ts"),
    ),
    ...bundle("chat-web"),
    ...bundle("admin-web"),
    bunStep("bun run e2e:studio", ["run", "e2e:studio"]),
    bunStep("bun run i18n:check", ["run", "i18n:check"]),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
    bunStep("bunx depcruise apps/admin-api apps/admin-web/src apps/chat-web/src apps/hub-api", [
      "x",
      "depcruise",
      "apps/admin-api",
      "apps/admin-web/src",
      "apps/chat-web/src",
      "apps/hub-api",
    ]),
    // Cuối cùng: hub-dev (needsDev) giữ :3001/:4000 tới hết runDone → chạy sau mọi bộ Playwright.
    bunStep(
      `HUB_URL=${HUB_URL} AUTH_URL=${AUTH_URL} CHAT_CONTRACT_USERS='<json>' bun run test:contract:chat`,
      ["run", "test:contract:chat"],
      { env: { HUB_URL, AUTH_URL, CHAT_CONTRACT_USERS: contractUsersJson() }, needsDev: true },
    ),
  ];
}

export const main = (argv: string[]): Promise<number> => runDone("x1", x1Steps(), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
