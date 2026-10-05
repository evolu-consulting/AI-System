// HUB-H2c · AC-H03 · `bun run done:h2c`: Lệnh xong mốc H2c — đúng `docs/specs/H2c-attachments/test-plan.md` §7.1
// (mọi bước `done:h2b` + phần H2c: unit `H2c/rules`, int `H2c/`, `test:h2c:stack`, H01 `H2c/hubdev` sau H01 H2b, perf H2c).
// Cơ chế chạy/bảng/dừng-ở-đỏ/`needsDev` dùng chung `runDone` (`done-h2a.ts`). Dùng: `bun run done:h2c [--from=<số bước>]`.

import { AUTH_URL, HUB_URL } from "../../hub-dev/src/dev";
import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";
import { byTitle, extend, HUBDEV_ARGS, h2bSteps } from "./done-h2b";

const BUN = process.execPath;
/** Bước H01 H2c: như H2b (`bunfig.stack.toml` vì `bunfig.toml`/`bunfig.int.toml` bỏ `H2c/hubdev/**`). */
export const HUBDEV_H2C_ARGS = [...HUBDEV_ARGS.slice(0, -1), "tests/acceptance/H2c/hubdev"];

const append = (step: Step, extra: string): Step => ({
  ...step,
  title: `${step.title} ${extra}`,
  argv: [...step.argv, extra],
});

/** §7.1 theo thứ tự (18 bước). */
export function h2cSteps(env: Record<string, string | undefined> = process.env): Step[] {
  const b = h2bSteps(env);
  const hubdevH2b = byTitle(b, `HUB_URL=${HUB_URL} AUTH_URL=${AUTH_URL} bun `);
  return [
    byTitle(b, "bunx turbo run typecheck"),
    append(byTitle(b, "bun test "), "tests/acceptance/H2c/rules"),
    extend(
      byTitle(b, "bun --env-file=.env.local --config=bunfig.int.toml"),
      "tests/acceptance/H2b/",
      "tests/acceptance/H2b/ tests/acceptance/H2c/",
    ),
    byTitle(b, "bun run contracts:check"),
    byTitle(b, "(cd apps/agent-runtime"),
    byTitle(b, "bun run test:h1:stack"),
    byTitle(b, "bun run test:h2a:stack"),
    byTitle(b, "bun run test:h2b:stack"),
    { title: "bun run test:h2c:stack", argv: [BUN, "run", "test:h2c:stack"], blocking: true },
    byTitle(b, `HUB_URL=${HUB_URL} AUTH_URL=${AUTH_URL} CHAT_CONTRACT_USERS=`),
    hubdevH2b,
    {
      ...hubdevH2b,
      title: `HUB_URL=${HUB_URL} AUTH_URL=${AUTH_URL} bun ${HUBDEV_H2C_ARGS.join(" ")}`,
      argv: [BUN, ...HUBDEV_H2C_ARGS],
    },
    byTitle(b, "bun run test:lock:verify"),
    byTitle(b, "bun run trace --check"),
    byTitle(b, "bun run check:size --all"),
    byTitle(b, "bunx depcruise "),
    byTitle(b, "tsc -p tsconfig.tests.json"),
    append(byTitle(b, "bun run test:perf"), "tests/acceptance/H2c"),
  ];
}

export const main = (argv: string[]): Promise<number> => runDone("h2c", h2cSteps(), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
