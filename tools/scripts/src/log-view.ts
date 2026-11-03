// Đọc cả log kv (`LOG_FORMAT=kv`) lẫn JSON (mặc định). `bun run log:view [file…] [--no-color] [--utc] [--run <6ký tự>]` — pretty-print log kv (CR-114). Không file ⇒ đọc stdin:
//   journalctl -u ai-worker -f | bun run log:view          docker logs -f hub-api | bun run log:view --run 0a1b2c
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { prettyLine, recordOf } from "./log-view.rules";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const ri = args.indexOf("--run");
const runFilter = ri >= 0 ? args[ri + 1] : undefined;
const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--run");
const opts = { color: !flag("--no-color") && !!process.stdout.isTTY, utc: flag("--utc") };

async function pipe(input: NodeJS.ReadableStream): Promise<void> {
  for await (const line of createInterface({ input })) {
    if (runFilter && recordOf(line)?.run !== runFilter) continue;
    console.log(prettyLine(line, opts));
  }
}

if (files.length === 0) await pipe(process.stdin);
else for (const f of files) await pipe(createReadStream(f, "utf8"));
