// N1 · `bun run done:n1`: Lệnh xong mốc N1. Chạy tuần tự, KHÔNG dừng ở bước đỏ; cuối in tổng kết. `--list` chỉ in các bước.
// Playwright cần Node thật (env `PLAYWRIGHT_NODE_DIR`), logic như done:pd1.

import { existsSync } from "node:fs";
import { n1Steps } from "./done-n1.rules";
import { detectRealNode, run } from "./done-pd1";
import { type PdStep, resolveNodeDir, summarize } from "./done-pd1.rules";

export function buildSteps(env: Record<string, string | undefined> = process.env): PdStep[] {
  const nodeDir = resolveNodeDir({
    override: env.PLAYWRIGHT_NODE_DIR,
    nodeOnPath: detectRealNode(),
    exists: existsSync,
  });
  return n1Steps({ bun: process.execPath, platform: process.platform, nodeDir });
}

export function main(argv: string[]): number {
  const steps = buildSteps();
  if (argv.includes("--list")) {
    for (const [i, s] of steps.entries())
      console.log(
        `${i + 1}. ${s.title}${s.nodeDir ? ` [PATH+=${s.nodeDir}]` : ""}\n   ${s.argv.join(" ")}`,
      );
    return 0;
  }
  const { text, ok } = summarize(steps.map(run), "done:n1");
  console.log(`\n${text}`);
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
