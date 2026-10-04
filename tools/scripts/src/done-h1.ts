// HUB-H1-AC-01 · `bun run done:h1`: Lệnh xong mốc H1 — chạy tuần tự đúng `docs/specs/H1-hub-core/test-plan.md` §7.1
// (chuẩn duy nhất; không thêm/bớt bước). Dừng ở bước chặn đỏ đầu tiên, phần còn lại in "chưa chạy"; hai lệnh
// "chỉ báo cáo" luôn chạy và không làm đỏ kết quả. Python đi qua `apps/agent-runtime/scripts/run.ts` (Windows:
// container) với URL DB test truyền trong chuỗi lệnh (env host không tự vào container). Python và TS dùng chung
// DB `ai_system_h1_test` nên không chạy song song. Dùng: `bun run done:h1 [--from=<số bước>]`.

import { AUTH_URL, HUB_URL, type HubDev, healthy, REPO, startHubDev } from "../../hub-dev/src/dev";
import { contractUsersJson, ensureContractFixture } from "../../hub-dev/src/fixture";

export type Step = {
  /** Lệnh nguyên văn §7.1 (in ra bảng). */
  title: string;
  argv: string[];
  env?: Record<string, string>;
  /** false = chỉ báo cáo. */
  blocking: boolean;
  /** Cần môi trường dev Hub (`tools/hub-dev`): tự bật nếu `:4000`/`:3001` chưa chạy. */
  needsDev?: boolean;
};
export type Outcome = "xanh" | "đỏ" | "chưa chạy" | "bỏ qua";
export type Result = { step: Step; outcome: Outcome; ms: number; note?: string };

const BUN = process.execPath;
const PY_CMD =
  "uv run ruff check . && uv run ruff format --check . && uv run pyright" +
  " && uv run lint-imports && uv run pytest && uv run pytest -m int";
const H1_DB = "ai_system_h1_test";

/** URL DB test cho tiến trình Python: trong container (không phải Linux) host = service compose `postgres:5432`. */
export function pyDbUrl(url: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "linux") return url;
  const u = new URL(url);
  u.hostname = "postgres";
  u.port = "5432";
  return u.toString();
}

/** Chuỗi lệnh chạy trong `apps/agent-runtime` (qua `scripts/run.ts`): export DB test → uv sync → §7.1. */
export function pythonCommand(
  env: Record<string, string | undefined>,
  platform = process.platform,
) {
  const owner = env.HUB_TEST_DATABASE_URL || `postgres://ai:ai_dev_pw@localhost:5432/${H1_DB}`;
  const rt =
    env.AGENT_RT_TEST_DATABASE_URL ||
    `postgres://agent_runtime:agent_runtime_dev_pw@localhost:5432/${H1_DB}`;
  return [
    `export HUB_TEST_DATABASE_URL='${pyDbUrl(owner, platform)}' AGENT_RT_TEST_DATABASE_URL='${pyDbUrl(rt, platform)}'`,
    "(uv sync --frozen 2>/dev/null || uv sync) >/dev/null 2>&1",
    PY_CMD,
  ].join("; ");
}

const bunStep = (title: string, args: string[], extra: Partial<Step> = {}): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
  ...extra,
});

/** §7.1 theo thứ tự; dòng `&&` cuối tách thành từng bước (cùng ngữ nghĩa: đỏ đầu tiên thì dừng). */
export function h1Steps(env: Record<string, string | undefined> = process.env): Step[] {
  const typecheck = "typecheck --filter=@ai/hub-api --filter=@ai/contracts --filter=@ai/db";
  const unit =
    "packages/contracts packages/db tests/acceptance/H1/rules tests/acceptance/H1/contracts-hub.test.ts";
  const int = "tests/acceptance/H1/ tests/acceptance/M tests/acceptance/ADM-NFR-06";
  const dep = "apps/hub-api packages/contracts/src/hub packages/db tools/hub-dev";
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
    bunStep("bun run depcruise --all", ["run", "depcruise", "--all"], { blocking: false }),
  ];
}

/** Bước chặn đỏ đầu tiên → các bước chặn sau "chưa chạy"; bước chỉ báo cáo vẫn chạy. */
export function shouldRun(step: Step, blockedBefore: boolean): boolean {
  return !step.blocking || !blockedBefore;
}

export const overallGreen = (rs: readonly Result[]): boolean =>
  rs.every((r) => !r.step.blocking || r.outcome === "xanh" || r.outcome === "bỏ qua") &&
  rs.some((r) => r.step.blocking && r.outcome === "xanh");

const fmtMs = (ms: number) =>
  ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`;
const COLOR: Record<Outcome, string> = { xanh: "32", đỏ: "31", "chưa chạy": "90", "bỏ qua": "90" };

export function formatTable(rs: readonly Result[], tty = process.stdout.isTTY ?? false): string {
  const paint = (o: Outcome) => (tty ? `\x1b[${COLOR[o]}m${o}\x1b[0m` : o);
  const rows = rs.map((r, i) => {
    const kind = r.step.blocking ? "chặn" : "báo cáo";
    const time = r.outcome === "xanh" || r.outcome === "đỏ" ? fmtMs(r.ms) : "-";
    const note = r.note ? ` (${r.note})` : "";
    return `${String(i + 1).padStart(2)}  ${paint(r.outcome).padEnd(tty ? 18 : 9)} ${time.padStart(7)}  [${kind}] ${r.step.title}${note}`;
  });
  return ["", "── done:h1 ──", ...rows].join("\n");
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

/** Bật dev Hub nếu cần (một lần); fixture idempotent khi admin-api có sẵn. Trả ghi chú lỗi hoặc null. */
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

async function runStep(step: Step, state: { dev?: HubDev }): Promise<Result> {
  const t0 = performance.now();
  const devErr = step.needsDev ? await prepareDev(state) : null;
  if (devErr) return { step, outcome: "đỏ", ms: performance.now() - t0, note: devErr };
  const code = exec(step);
  return { step, outcome: code === 0 ? "xanh" : "đỏ", ms: performance.now() - t0 };
}

type RunState = { dev?: HubDev; blocked: boolean; from: number };

async function visit(step: Step, n: number, st: RunState): Promise<Result> {
  if (step.blocking && n < st.from)
    return { step, outcome: "bỏ qua", ms: 0, note: `--from=${st.from}` };
  if (!shouldRun(step, st.blocked)) return { step, outcome: "chưa chạy", ms: 0 };
  const r = await runStep(step, st);
  if (step.blocking && r.outcome === "đỏ") st.blocked = true;
  return r;
}

export async function main(argv: string[]): Promise<number> {
  const from = Number(argv.find((a) => a.startsWith("--from="))?.slice(7) ?? "1");
  const st: RunState = { blocked: false, from };
  const results: Result[] = [];
  for (const [i, step] of h1Steps().entries()) results.push(await visit(step, i + 1, st));
  await st.dev?.stop();
  console.log(formatTable(results));
  const ok = overallGreen(results) && !st.blocked;
  const partial = from > 1 ? ` (từ bước ${from} — chưa phải done:h1 đủ)` : "";
  console.log(ok ? `done:h1 XANH${partial}` : "done:h1 ĐỎ");
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
