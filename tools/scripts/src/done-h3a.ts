// HUB-H3a · WRK-FR-22 · `bun run done:h3a`: Lệnh xong mốc H3a — đúng `docs/specs/H3a-subscription/test-plan.md` §6
// (mọi bước `done:h2c` + unit `H3a/rules`, int `H3a/`, `test:h3a:stack` sau stack cũ; Python sẵn có đã gồm toàn thư mục).
// Không bước perf mới (đo trong int). Cơ chế dùng chung `runDone`. Dùng: `bun run done:h3a [--from=<số bước>]`.

import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";
import { extend } from "./done-h2b";
import { h2cSteps } from "./done-h2c";

const BUN = process.execPath;

/** §6 theo thứ tự (19 bước): `done:h2c` + H3a. */
export function h3aSteps(env: Record<string, string | undefined> = process.env): Step[] {
  const out: Step[] = [];
  for (const s of h2cSteps(env)) {
    if (s.title.startsWith("bun test ")) {
      out.push({
        ...s,
        title: `${s.title} tests/acceptance/H3a/rules`,
        argv: [...s.argv, "tests/acceptance/H3a/rules"],
      });
    } else if (s.title.startsWith("bun --env-file=.env.local --config=bunfig.int.toml")) {
      out.push(extend(s, "tests/acceptance/H2c/", "tests/acceptance/H2c/ tests/acceptance/H3a/"));
    } else {
      out.push(s);
    }
    if (s.title === "bun run test:h2c:stack")
      out.push({
        title: "bun run test:h3a:stack",
        argv: [BUN, "run", "test:h3a:stack"],
        blocking: true,
      });
  }
  return out;
}

export const main = (argv: string[]): Promise<number> => runDone("h3a", h3aSteps(), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
