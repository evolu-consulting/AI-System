// H4b1-AC · HUB-FR-68, HUB-FR-69 · `bun run done:h4b1`: Lệnh xong mốc H4b1-secrets — `docs/specs/H4b1-secrets/tasks.md` "Đề xuất done:h4b1".
// Tuần tự, dừng ở bước đỏ đầu (cơ chế `runDone`). int + e2e dùng DB test: không chạy song song với bộ khác.
// Phạm vi LOẠI K1 (mốc song song chưa code: tests/acceptance/K1/*, e2e/studio/k1-*): bun test/test:int dùng bunfig tạm
// = bunfig gốc + `tests/acceptance/K1/**` trong pathIgnorePatterns; e2e liệt kê file *.studio.ts trừ k1-*.
// Đỏ đã biết chấp nhận (KHÔNG ẩn, phân loại khi báo cáo): TECH-DEBT #148 (4 ca packages/db hub-rls/migrate-hub), R49.
// Đỏ cũ ngoài H4b-1 (không do H4b-1; TECH-DEBT #149 cho refs-feedback): contracts-h2c fixture SourceResolveJob.git (thiếu schema đăng ký) và
// P-b/pfs3 refs-feedback RFB-12 (chữ ký 5 tham số) — tách khỏi bun test chặn, chạy ở bước KHÔNG chặn để vẫn hiện trong bảng.
// Dùng: `bun run done:h4b1 [--from=<số bước>] [--skip=int,e2e]` (`--skip` bỏ nhóm tốn DB/cổng; KHÔNG phải done đủ).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Step } from "./done-h1";
import { runDone } from "./done-h2a";
import { parseSkip, type Skip } from "./done-x2b";

const BUN = process.execPath;
const K1_IGNORE = [
  "tests/acceptance/K1/**",
  "packages/db/src/hub-k1.int.test.ts",
  "apps/hub-api/src/modules/kh/**",
];
const KNOWN_RED = [
  "tests/acceptance/H2c/rules/contracts-h2c.test.ts",
  "tests/acceptance/P-b/pfs3/rules/refs-feedback.rules.test.ts",
];

const bunStep = (title: string, args: string[], extra: Partial<Step> = {}): Step => ({
  title,
  argv: [BUN, ...args],
  blocking: true,
  ...extra,
});

/** Bản sao bunfig `src` có thêm K1 vào pathIgnorePatterns (ghi vào thư mục tạm; trả đường dẫn). */
export function bunfigWithoutK1(src: string, out: string, extra: string[] = []): string {
  const text = readFileSync(src, "utf8");
  const next = text.replace(
    /pathIgnorePatterns\s*=\s*\[/,
    `pathIgnorePatterns = [${[...K1_IGNORE, ...extra].map((p) => `"${p}"`).join(", ")}, `,
  );
  if (next === text) throw new Error(`${src}: không thấy pathIgnorePatterns`);
  const dir = join(tmpdir(), "done-h4b1");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, out);
  writeFileSync(file, next);
  return file;
}

/** File e2e studio (tên không đuôi) trừ k1-*; làm bộ lọc positional của Playwright. */
export function studioSpecs(dir = "e2e/studio"): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".studio.ts") && !f.startsWith("k1-"))
    .map((f) => f.replace(/\.ts$/, ""));
}

const INT_KNOWN_RED = [
  "packages/db/src/hub-rls.int.test.ts",
  "packages/db/src/migrate-hub.int.test.ts",
];
const intArgs = (config: string, paths: string[]) => [
  "--env-file=.env.local",
  `--config=${config}`,
  "test",
  "--timeout",
  "40000",
  ...paths,
];

const intSteps = (): Step[] => [
  bunStep("bun run test:int (trừ K1, trừ #148)", [
    ...intArgs(bunfigWithoutK1("bunfig.int.toml", "int.toml", INT_KNOWN_RED), [".int.test"]),
  ]),
  bunStep(
    "bun test:int packages/db hub-rls + migrate-hub (đỏ cũ #148, không chặn)",
    intArgs("bunfig.int.toml", INT_KNOWN_RED),
    { blocking: false },
  ),
];

const e2eSteps = (): Step[] => [
  bunStep("bunx playwright test -c e2e/studio/playwright.config.ts (trừ k1-*)", [
    "x",
    "playwright",
    "test",
    "-c",
    "e2e/studio/playwright.config.ts",
    ...studioSpecs(),
  ]),
];

/** Thứ tự = tasks.md "Đề xuất done:h4b1". */
export function h4b1Steps(skip: Skip = new Set()): Step[] {
  return [
    bunStep("bun run typecheck", ["run", "typecheck"]),
    bunStep("bun test (trừ K1)", [
      `--config=${bunfigWithoutK1("bunfig.toml", "unit.toml", KNOWN_RED)}`,
      "test",
    ]),
    bunStep("bun test đỏ cũ ngoài H4b-1 (không chặn)", ["test", ...KNOWN_RED], {
      blocking: false,
    }),
    ...(skip.has("int") ? [] : intSteps()),
    ...(skip.has("e2e") ? [] : e2eSteps()),
    bunStep("bun run trace --check", ["run", "trace", "--check"]),
    bunStep("bun run test:lock:verify", ["run", "test:lock:verify"]),
  ];
}

export const main = (argv: string[]): Promise<number> =>
  runDone("h4b1", h4b1Steps(parseSkip(argv)), argv);

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
