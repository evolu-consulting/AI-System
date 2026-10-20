// Chạy Playwright bằng Node thật (không qua shim node của Bun): `bun tools/scripts/src/run-playwright.ts <config> [args…]`.
// Dùng lại resolveNodeDir/detectRealNode của done:pd1.

import { existsSync } from "node:fs";
import { playwrightArgv } from "./done-n1.rules";
import { detectRealNode, REPO, stepEnv } from "./done-pd1";
import { resolveNodeDir } from "./done-pd1.rules";

export function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): number {
  // Đối số đầu dạng KEY=VAL là biến môi trường cho Playwright (vd `CW_MODE=capture`), sau đó là config rồi đối số thêm.
  let n = 0;
  while (/^\w+=/.test(argv[n] ?? "")) n++;
  const sets = argv.slice(0, n);
  const [config, ...extra] = argv.slice(n);
  const extraEnv = Object.fromEntries(
    sets.map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]),
  );
  if (!config) {
    console.error("Dùng: bun tools/scripts/src/run-playwright.ts <config> [args…]");
    return 2;
  }
  const nodeDir = resolveNodeDir({
    override: env.PLAYWRIGHT_NODE_DIR,
    nodeOnPath: detectRealNode(),
    exists: existsSync,
  });
  const argvOut = playwrightArgv(
    { bun: process.execPath, platform: process.platform, nodeDir },
    config,
    extra,
  );
  const p = Bun.spawnSync(argvOut, {
    cwd: REPO,
    env: stepEnv({
      title: "playwright",
      argv: argvOut,
      env: extraEnv,
      ...(nodeDir ? { nodeDir } : {}),
    }),
    stdout: "inherit",
    stderr: "inherit",
  });
  return p.exitCode ?? 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
