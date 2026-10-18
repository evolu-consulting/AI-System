// P-d2 · HUB-FR-146 · luật thuần của `bun run done:pd2` (T20): danh sách bước. Hàm dùng chung nằm ở done-pd1.rules.
// `done-pd2.ts` lo chạy lệnh. Không dừng ở bước đỏ đầu — chạy hết rồi in tổng kết.

import type { PdStep } from "./done-pd1.rules";

const ACCEPTANCE = ["P-d", "P-a", "P-b", "P-b2", "P-c", "P-c2", "H2a"];

function playwrightStep(o: { bun: string; platform: string; nodeDir: string | null }): PdStep {
  const cfg = "e2e/P-d/playwright.pd.config.ts";
  // Có nodeDir ⇒ gọi thẳng node.exe + CLI Playwright (như pd1): `bun x` vẫn chọn shim `node` giả của Bun.
  const argv = o.nodeDir
    ? [
        `${o.nodeDir}${o.platform === "win32" ? "\\node.exe" : "/node"}`,
        "node_modules/@playwright/test/cli.js",
        "test",
        "-c",
        cfg,
      ]
    : [o.bun, "x", "playwright", "test", "-c", cfg];
  return { title: "playwright P-d", argv, ...(o.nodeDir ? { nodeDir: o.nodeDir } : {}) };
}

/** Thứ tự = T20. `bun:test:perf:pd` quét cả thư mục tests/acceptance/P-d/perf/ nên đã gồm d2.perf.int.test.ts. */
export function pd2Steps(o: { bun: string; platform: string; nodeDir: string | null }): PdStep[] {
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
      title: "depcruise --all (0 vi phạm ca-*)",
      argv: [bun, "run", "depcruise", "--all"],
      kind: "depcruise",
    },
    {
      title: "bun test (hub-api, admin-web, chat-web, contracts, P-d/rules)",
      argv: [
        bun,
        "test",
        "apps/hub-api",
        "apps/admin-web",
        "apps/chat-web",
        "packages/contracts",
        "tests/acceptance/P-d/rules",
      ],
    },
    {
      title: "int P-d + hồi quy P-a P-b P-b2 P-c P-c2 H2a",
      argv: [bun, "run", "test:int:par", ...ACCEPTANCE.map((d) => `tests/acceptance/${d}`)],
    },
    { title: "bun run test:perf:pd (gồm d2.perf)", argv: [bun, "run", "test:perf:pd"] },
    playwrightStep(o),
    ...web("admin-web"),
    ...web("chat-web"),
    { title: "bun run test:lock:verify", argv: [bun, "run", "test:lock:verify"] },
  ];
}
