// HUB-H4a · HUB-FR-72 · `bun run done:h4a`: Lệnh xong mốc H4a — đúng `docs/specs/H4a-studio-shell-agents/test-plan.md` §6
// (mọi bước `done:h3b` + unit `H4a/rules`, int `H4a/`, typecheck studio-web, `e2e:studio`, `check:bundle` studio-web, depcruise studio-web).
// Cơ chế dùng chung `runDone`. Dùng: `bun run done:h4a [--from=<số bước>]`.

import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";
import { extend } from "./done-h2b";
import { h3bSteps } from "./done-h3b";

const BUN = process.execPath;

/** Thứ tự = `done:h3b` (19 bước) + H4a; `e2e:studio` + `check:bundle` chèn trước `test:lock:verify`. */
export function h4aSteps(env: Record<string, string | undefined> = process.env): Step[] {
  const out: Step[] = [];
  for (const s of h3bSteps(env)) {
    let step: Step = s;
    if (s.title.startsWith("bunx turbo run typecheck"))
      step = {
        ...s,
        title: `${s.title} --filter=@ai/studio-web`,
        argv: [...s.argv, "--filter=@ai/studio-web"],
      };
    else if (s.title.startsWith("bun test "))
      step = {
        ...s,
        title: `${s.title} tests/acceptance/H4a/rules`,
        argv: [...s.argv, "tests/acceptance/H4a/rules"],
      };
    else if (s.title.startsWith("bun --env-file=.env.local --config=bunfig.int.toml"))
      step = extend(s, "tests/acceptance/H3b/", "tests/acceptance/H3b/ tests/acceptance/H4a/");
    else if (s.title.startsWith("bunx depcruise "))
      step = {
        ...s,
        title: `${s.title} apps/studio-web/src`,
        argv: [...s.argv, "apps/studio-web/src"],
      };
    if (s.title === "bun run test:lock:verify") {
      out.push({ title: "bun run e2e:studio", argv: [BUN, "run", "e2e:studio"], blocking: true });
      out.push({
        title: "bun run check:bundle --filter=@ai/studio-web",
        argv: [BUN, "run", "check:bundle", "--", "--filter=@ai/studio-web"],
        blocking: true,
      });
    }
    out.push(step);
  }
  return out;
}

export const main = (argv: string[]): Promise<number> => runDone("h4a", h4aSteps(), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
