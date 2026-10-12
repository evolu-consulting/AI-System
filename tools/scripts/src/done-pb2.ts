// P-b2-AC · HUB-FR-104…118, HUB-FR-136, ADM-FR-71, CHAT-AC-59/60 · `bun run done:pb2`: Lệnh xong mốc P-b2 (canvas bước) — theo
// `docs/specs/P-b2-canvas/test-plan.md` §7. Dừng ở bước đỏ đầu; cơ chế `runDone`. Bước dùng DB/cổng chạy tuần tự.
// Hồi quy e2e P-a/P-b và UAT Claude thật KHÔNG nằm ở đây: T11 chạy đủ `done:pa` + `done:pb` riêng; UAT do qc-uat.
// Dùng: `bun run done:pb2 [--from=<số bước>] [--skip=int,e2e]` (`--skip` bỏ nhóm bước tốn DB/cổng; KHÔNG phải done đủ).

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";
import { parseSkip, type Skip } from "./done-x2b";

const BUN = process.execPath;

const bunStep = (title: string, args: string[], extra: Partial<Step> = {}): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
  ...extra,
});

/** DB test riêng mỗi lát (`.env.test-<tag>.local`); `db:test:create` idempotent (tạo nếu thiếu + migrate). */
const dbCreate = (tag: string): Step =>
  bunStep(`bun run db:test:create ${tag}`, ["run", "db:test:create", tag]);

// Dấu `/` cuối: bun test lọc theo chuỗi con của đường dẫn ⇒ `X2b` kéo cả `X2b2`.
const intSlice = (tag: string, dir: string): Step[] => [
  dbCreate(tag),
  bunStep(
    `bun --env-file=.env.test-${tag}.local --config=bunfig.int.toml test tests/acceptance/${dir}/`,
    [
      `--env-file=.env.test-${tag}.local`,
      "--config=bunfig.int.toml",
      "test",
      "--timeout",
      "60000",
      `tests/acceptance/${dir}/`,
    ],
  ),
];

const REGRESS_BASE = [
  "--env-file=.env.local",
  "--config=bunfig.int.toml",
  "test",
  "--timeout",
  "60000",
];
// X2b2/regress KHÔNG nằm đây: X2b-2 tạm dừng sau B1 (STATE N0) ⇒ 4 ca đỏ có sẵn (gửi file phòng còn 400 strict) — thêm lại khi X2b-2 xong.
const REGRESS = [
  "P-a/step0",
  "P-a/pf1",
  "P-a/pf2",
  "P-a/scenario",
  "P-b/pfs1",
  "P-b/pfs3",
  "P-b/pfs4",
].map((d) => `tests/acceptance/${d.endsWith(".int") ? d : `${d}/`}`);

const intSteps = (): Step[] => [
  ...["s0", "par", "back", "tok", "compat"].flatMap((d) => intSlice(`pb2_${d}`, `P-b2/${d}`)),
  bunStep(`bun ${REGRESS_BASE.join(" ")} ${REGRESS.join(" ")}`, [...REGRESS_BASE, ...REGRESS]),
];

const DROP_E2E_DB = `import postgres from "postgres";
const url = process.env.TEST_DATABASE_URL;
if (!url || !url.endsWith("_test")) throw new Error("TEST_DATABASE_URL phải kết thúc _test");
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql\`DROP SCHEMA IF EXISTS admin, hub, drizzle CASCADE\`;
await sql.end();`;

/** Biến của `.env.test-pb2_e2e.local`: parent chạy `--env-file=.env.local` nên phải đặt tường minh (không ghi đè biến có sẵn). */
function e2eEnv(): Record<string, string> {
  return parseEnv(readFileSync(".env.test-pb2_e2e.local", "utf8")) as Record<string, string>;
}

const e2eSteps = (): Step[] => [
  dbCreate("pb2_e2e"),
  bunStep("DROP SCHEMA admin,hub,drizzle (DB e2e P-b2, .env.test-pb2_e2e.local)", [
    "--env-file=.env.test-pb2_e2e.local",
    "-e",
    DROP_E2E_DB,
  ]),
  bunStep(
    "bunx playwright test -c e2e/P-b2/playwright.pb2.config.ts --reporter=line",
    [
      "x",
      "playwright",
      "test",
      "-c",
      "e2e/P-b2/playwright.pb2.config.ts",
      "--reporter=line",
      "--output=test-results-pb2",
    ],
    { env: e2eEnv() },
  ),
];

const buildSteps = (): Step[] =>
  ["admin-web", "chat-web"].flatMap((app) => [
    bunStep(`bun run --filter @ai/${app} build`, ["run", "--filter", `@ai/${app}`, "build"]),
    bunStep(`bun run --filter @ai/${app} check:bundle`, [
      "run",
      "--filter",
      `@ai/${app}`,
      "check:bundle",
    ]),
  ]);

/** Thứ tự = test-plan §7 (tĩnh · contract/rules · int · build · e2e · khoá/trace). */
export function pb2Steps(skip: Skip = new Set()): Step[] {
  return [
    bunStep("bun run check", ["run", "check"]),
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep("bun run i18n:check", ["run", "i18n:check"]),
    bunStep("bun run check:size", ["run", "check:size"]),
    bunStep("bun test packages/contracts", ["test", "packages/contracts"]),
    bunStep("bun test tests/acceptance/P-b2 (rules; bunfig bỏ *.int.test.ts)", [
      "test",
      "tests/acceptance/P-b2",
    ]),
    bunStep("bun test apps/hub-api apps/admin-web apps/chat-web (unit dev)", [
      "test",
      "apps/hub-api",
      "apps/admin-web",
      "apps/chat-web",
    ]),
    ...(skip.has("int") ? [] : intSteps()),
    ...buildSteps(),
    ...(skip.has("e2e") ? [] : e2eSteps()),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
  ];
}

export const main = (argv: string[]): Promise<number> =>
  runDone("pb2", pb2Steps(parseSkip(argv)), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
