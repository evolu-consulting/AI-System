// N1 · luật thuần của `bun run done:n1`: danh sách bước (dùng lại PdStep/summarize của done-pd1.rules).
// `done-n1.ts` lo chạy lệnh. Không dừng ở bước đỏ đầu — chạy hết rồi in tổng kết.

import type { PdStep } from "./done-pd1.rules";

type Opts = { bun: string; platform: string; nodeDir: string | null };

const BUN_TEST_DIRS = [
  "apps/hub-api",
  "apps/admin-api",
  "apps/contracts-web",
  "apps/chat-web",
  "packages",
  "tests/acceptance/N1/rules",
];

/** Gồm hồi quy admin (nợ #206). */
const INT_DIRS = ["N1", "HD1", "P-d", "M1", "M2", "M3", "M4", "ADM-NFR-06"].map(
  (d) => `tests/acceptance/${d}`,
);

/** argv chạy Playwright: có nodeDir ⇒ node.exe + CLI (`bun x` chọn shim node giả của Bun ⇒ "No tests found"). */
export function playwrightArgv(o: Opts, config: string, extra: string[] = []): string[] {
  const tail = ["test", "-c", config, ...extra];
  return o.nodeDir
    ? [
        `${o.nodeDir}${o.platform === "win32" ? "\\node.exe" : "/node"}`,
        "node_modules/@playwright/test/cli.js",
        ...tail,
      ]
    : [o.bun, "x", "playwright", ...tail];
}

function pw(o: Opts, title: string, config: string): PdStep {
  return {
    title,
    argv: playwrightArgv(o, config),
    ...(o.nodeDir ? { nodeDir: o.nodeDir } : {}),
  };
}

export function n1Steps(o: Opts): PdStep[] {
  const { bun } = o;
  const typecheck =
    o.platform === "win32"
      ? [bun, "x", "turbo", "typecheck", "--filter=!@ai/agent-runtime"]
      : [bun, "run", "typecheck"];
  const web = (app: string): PdStep[] => [
    { title: `build ${app}`, argv: [bun, "run", "--cwd", `apps/${app}`, "build"] },
    { title: `check:bundle ${app}`, argv: [bun, "run", "--cwd", `apps/${app}`, "check:bundle"] },
  ];
  return [
    { title: "typecheck", argv: typecheck },
    {
      title: "depcruise --all (0 vi phạm ca-*/pack-*)",
      argv: [bun, "run", "depcruise", "--all"],
      kind: "depcruise",
      rulePrefixes: ["ca-", "pack-"],
    },
    { title: "bun test (apps, packages, N1/rules)", argv: [bun, "test", ...BUN_TEST_DIRS] },
    {
      title: "int N1 HD1 P-d M1-M4 ADM-NFR-06 packages/db",
      argv: [bun, "run", "test:int:par", ...INT_DIRS, "packages/db/src"],
    },
    {
      title: "perf N1",
      argv: [
        bun,
        "--env-file=.env.local",
        "--config=bunfig.perf.toml",
        "test",
        "--timeout",
        "120000",
        "tests/acceptance/N1/perf/",
      ],
      env: { PERF: "1" },
    },
    pw(o, "playwright N1", "e2e/N1/playwright.config.ts"),
    pw(o, "playwright contracts-web", "e2e/contracts-web/playwright.config.ts"),
    pw(o, "playwright chat", "e2e/chat/playwright.config.ts"),
    ...web("contracts-web"),
    ...web("chat-web"),
    ...web("admin-web"),
    { title: "bun run check:fn", argv: [bun, "run", "check:fn"] },
    { title: "bun run test:lock:verify", argv: [bun, "run", "test:lock:verify"] },
  ];
}
