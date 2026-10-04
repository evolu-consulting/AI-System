// HUB-H2a-AC-12 · `bun run done:h2a`: Lệnh xong mốc H2a — đúng `docs/specs/H2a-dify-command/test-plan.md` §7.1
// (kế thừa mọi bước `done:h1` + H2a/ + khoá C1/M2/M3). Cơ chế chạy/bảng/dừng-ở-đỏ dùng chung với `done-h1.ts`.
// Dùng: `bun run done:h2a [--from=<số bước>]`.

import { AUTH_URL, HUB_URL, type HubDev, healthy, REPO, startHubDev } from "../../hub-dev/src/dev";
import { contractUsersJson, ensureContractFixture } from "../../hub-dev/src/fixture";
import {
  formatTable,
  overallGreen,
  pythonCommand,
  type Result,
  type Step,
  shouldRun,
} from "./done-h1";

const BUN = process.execPath;
const PY_CMD =
  "uv run ruff check . && uv run ruff format --check . && uv run pyright" +
  " && uv run lint-imports && uv run pytest && uv run pytest -m int";

const bunStep = (title: string, args: string[], extra: Partial<Step> = {}): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
  ...extra,
});

/** §7.1 theo thứ tự; dòng `&&` (stack, cuối) tách thành từng bước. */
export function h2aSteps(env: Record<string, string | undefined> = process.env): Step[] {
  const typecheck =
    "typecheck --filter=@ai/hub-api --filter=@ai/contracts --filter=@ai/db --filter=@ai/scripts --filter=@ai/chat-web --filter=@ai/mocks";
  const unit =
    "packages/contracts packages/db tools/hub-dev apps/admin-api/src/modules/access tests/acceptance/C1 tests/acceptance/H1/rules tests/acceptance/H2a/rules";
  const int =
    "tests/acceptance/H1/ tests/acceptance/H2a/ tests/acceptance/M tests/acceptance/ADM-NFR-06";
  const dep =
    "apps/hub-api packages/contracts/src/hub packages/contracts/src/hub-internal packages/db tools/hub-dev";
  return [
    bunStep(`bunx turbo run ${typecheck}`, ["x", "turbo", "run", ...typecheck.split(" ")]),
    bunStep(`bun test ${unit}`, ["test", ...unit.split(" ")]),
    bunStep(`bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 ${int}`, [
      "--env-file=.env.local",
      "--config=bunfig.int.toml",
      "test",
      "--timeout",
      "30000",
      ...int.split(" "),
    ]),
    bunStep("bun run contracts:check", ["run", "contracts:check"]),
    bunStep(`(cd apps/agent-runtime && ${PY_CMD})`, [
      "apps/agent-runtime/scripts/run.ts",
      pythonCommand(env),
    ]),
    bunStep("bun run test:h1:stack", ["run", "test:h1:stack"]),
    bunStep("bun run test:h2a:stack", ["run", "test:h2a:stack"]),
    bunStep(
      `HUB_URL=${HUB_URL} AUTH_URL=${AUTH_URL} CHAT_CONTRACT_USERS='<json>' bun run test:contract:chat`,
      ["run", "test:contract:chat"],
      { env: { HUB_URL, AUTH_URL, CHAT_CONTRACT_USERS: contractUsersJson() }, needsDev: true },
    ),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
    bunStep("bun run check:size --all", ["run", "check:size", "--all"]),
    bunStep(`bunx depcruise ${dep}`, ["x", "depcruise", ...dep.split(" ")]),
    bunStep("tsc -p tsconfig.tests.json", ["x", "tsc", "-p", "tsconfig.tests.json"], {
      blocking: false,
    }),
    bunStep(
      "bun run test:perf tests/acceptance/H2a",
      ["run", "test:perf", "tests/acceptance/H2a"],
      { blocking: false },
    ),
  ];
}

function exec(step: Step): number {
  console.log(`\n▶ ${step.title}`);
  const p = Bun.spawnSync(step.argv, {
    cwd: REPO,
    env: { ...process.env, ...step.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  return p.exitCode ?? 1;
}

async function prepareDev(state: { dev?: HubDev }): Promise<string | null> {
  try {
    if (!(await healthy(HUB_URL)) || !(await healthy(AUTH_URL))) {
      state.dev = await startHubDev();
      for (const n of state.dev.notes) console.warn(`[hub-dev] ${n}`);
    } else await ensureContractFixture(AUTH_URL);
    return null;
  } catch (err) {
    return `hub-dev: ${(err as Error).message}`;
  }
}

type RunState = { dev?: HubDev; blocked: boolean; from: number };

async function visit(step: Step, n: number, st: RunState): Promise<Result> {
  if (step.blocking && n < st.from)
    return { step, outcome: "bỏ qua", ms: 0, note: `--from=${st.from}` };
  if (!shouldRun(step, st.blocked)) return { step, outcome: "chưa chạy", ms: 0 };
  const t0 = performance.now();
  const devErr = step.needsDev ? await prepareDev(st) : null;
  const code = devErr ? 1 : exec(step);
  const outcome = code === 0 ? "xanh" : "đỏ";
  if (step.blocking && outcome === "đỏ") st.blocked = true;
  return { step, outcome, ms: performance.now() - t0, ...(devErr ? { note: devErr } : {}) };
}

export async function main(argv: string[]): Promise<number> {
  const from = Number(argv.find((a) => a.startsWith("--from="))?.slice(7) ?? "1");
  const st: RunState = { blocked: false, from };
  const results: Result[] = [];
  for (const [i, step] of h2aSteps().entries()) results.push(await visit(step, i + 1, st));
  await st.dev?.stop();
  console.log(formatTable(results).replace("done:h1", "done:h2a"));
  const ok = overallGreen(results) && !st.blocked;
  const partial = from > 1 ? ` (từ bước ${from} — chưa phải done:h2a đủ)` : "";
  console.log(ok ? `done:h2a XANH${partial}` : "done:h2a ĐỎ");
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
