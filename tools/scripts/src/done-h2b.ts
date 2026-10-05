// HUB-H2b-AC-13 · `bun run done:h2b`: Lệnh xong mốc H2b — đúng `docs/specs/H2b-routing/test-plan.md` §7.1
// (mọi bước `done:h2a` + phần H2b: unit/int `H2b/`, `test:h2b:stack`, H01 `H2b/hubdev` sau contract chat, perf H2b).
// Cơ chế chạy/bảng/dừng-ở-đỏ/`needsDev` dùng chung `runDone` (`done-h2a.ts`). Dùng: `bun run done:h2b [--from=<số bước>]`.

import { AUTH_URL, HUB_URL } from "../../hub-dev/src/dev";
import type { Step } from "./done-h1";
import { h2aSteps, runDone } from "./done-h2a";

const BUN = process.execPath;
/** Bước H01 (L6): `bunfig.toml` bỏ `H2b/hubdev/**` nên chạy bằng `bunfig.stack.toml` (không bỏ thư mục stack). */
export const HUBDEV_ARGS = [
  "--env-file=.env.local",
  "--config=bunfig.stack.toml",
  "test",
  "--timeout",
  "120000",
  "tests/acceptance/H2b/hubdev",
];

/** Thay `from` → `to` trong cả tiêu đề lẫn argv (một token argv có thể là cả chuỗi lệnh). */
function extend(step: Step, from: string, to: string): Step {
  return {
    ...step,
    title: step.title.replace(from, to),
    argv: step.argv.flatMap((a) => (a === from ? to.split(" ") : [a])),
  };
}

const byTitle = (steps: Step[], prefix: string): Step => {
  const s = steps.find((x) => x.title.startsWith(prefix));
  if (!s) throw new Error(`done:h2a thiếu bước "${prefix}"`);
  return s;
};

/** §7.1 theo thứ tự (16 bước). */
export function h2bSteps(env: Record<string, string | undefined> = process.env): Step[] {
  const a = h2aSteps(env);
  const contract = byTitle(a, `HUB_URL=${HUB_URL}`);
  const unit = byTitle(a, "bun test ");
  const int = byTitle(a, "bun --env-file=.env.local --config=bunfig.int.toml");
  const perf = byTitle(a, "bun run test:perf");
  return [
    byTitle(a, "bunx turbo run typecheck"),
    {
      ...unit,
      title: `${unit.title} tests/acceptance/H2b/rules`,
      argv: [...unit.argv, "tests/acceptance/H2b/rules"],
    },
    extend(int, "tests/acceptance/H2a/", "tests/acceptance/H2a/ tests/acceptance/H2b/"),
    byTitle(a, "bun run contracts:check"),
    byTitle(a, "(cd apps/agent-runtime"),
    byTitle(a, "bun run test:h1:stack"),
    byTitle(a, "bun run test:h2a:stack"),
    { title: "bun run test:h2b:stack", argv: [BUN, "run", "test:h2b:stack"], blocking: true },
    contract,
    {
      title: `HUB_URL=${HUB_URL} AUTH_URL=${AUTH_URL} bun ${HUBDEV_ARGS.join(" ")}`,
      argv: [BUN, ...HUBDEV_ARGS],
      env: { HUB_URL, AUTH_URL },
      blocking: true,
      needsDev: true,
    },
    byTitle(a, "bun run test:lock:verify"),
    byTitle(a, "bun run trace --check"),
    byTitle(a, "bun run check:size --all"),
    byTitle(a, "bunx depcruise "),
    byTitle(a, "tsc -p tsconfig.tests.json"),
    {
      ...perf,
      title: `${perf.title} tests/acceptance/H2b`,
      argv: [...perf.argv, "tests/acceptance/H2b"],
    },
  ];
}

export const main = (argv: string[]): Promise<number> => runDone("h2b", h2bSteps(), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
