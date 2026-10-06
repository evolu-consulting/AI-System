// HUB-H3b · HUB-FR-78 · `bun run done:h3b`: Lệnh xong mốc H3b — đúng `docs/specs/H3b-agent-grants/plan.md` §8 + `test-plan.md` §7
// (mọi bước `done:h3a` + unit `H3b/rules`, int `H3b/`; không stack mới, không perf mới).
// `tests/acceptance/H3b-cmd/**` (AC-13) NGOÀI lệnh này: qc chạy tay; bunfig bỏ qua, và `H3b/` (có `/` cuối) không khớp `H3b-cmd/`.
// Cơ chế dùng chung `runDone`. Dùng: `bun run done:h3b [--from=<số bước>]`.

import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";
import { extend } from "./done-h2b";
import { h3aSteps } from "./done-h3a";

/** Thứ tự = `done:h3a` (19 bước), unit/int chỉ nối thêm H3b. */
export function h3bSteps(env: Record<string, string | undefined> = process.env): Step[] {
  return h3aSteps(env).map((s) => {
    if (s.title.startsWith("bun test "))
      return {
        ...s,
        title: `${s.title} tests/acceptance/H3b/rules`,
        argv: [...s.argv, "tests/acceptance/H3b/rules"],
      };
    if (s.title.startsWith("bun --env-file=.env.local --config=bunfig.int.toml"))
      return extend(s, "tests/acceptance/H3a/", "tests/acceptance/H3a/ tests/acceptance/H3b/");
    return s;
  });
}

export const main = (argv: string[]): Promise<number> => runDone("h3b", h3bSteps(), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
