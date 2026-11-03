// CR-114 hub-eval · điểm vào CLI: `bun run eval:hub …` (xem `cli.ts`).
import { runCli } from "./cli";

const r = await runCli(process.argv.slice(2));
if (r.stderr) process.stderr.write(r.stderr);
if (r.stdout) process.stdout.write(r.stdout);
process.exit(r.code);
