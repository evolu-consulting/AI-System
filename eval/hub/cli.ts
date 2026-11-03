// CR-114 hub-eval · `bun run eval:hub [--mode replay|live] [--filter a,b] [--json] [--baseline <file>] [--threshold 0.05]
//   [--yes] [--model m] [--judge-model m] [--record <file>] [--write-baseline <file>]`.
// Mã thoát: 0 ổn · 1 hồi quy vượt ngưỡng (so baseline) · 2 sai tham số / chưa đủ điều kiện live.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelProvider } from "../../apps/hub-api/src/lib/ai-client/ai-client";
import { DEFAULT_THRESHOLD, diffBaseline, summarize, toBaseline } from "./baseline";
import { estimateCost, formatEstimate, liveSource, recordingSource } from "./live";
import { filterCases, replaySource, runEval } from "./runner";
import type { Baseline, EvalCase, Fixtures, Recorded, Report } from "./types";

export const EVAL_DIR = join(import.meta.dir);
const VALUE_FLAGS = new Set([
  "mode",
  "filter",
  "baseline",
  "threshold",
  "model",
  "judge-model",
  "record",
  "write-baseline",
]);
const BOOL_FLAGS = new Set(["json", "yes"]);

export type Args = Record<string, string | boolean>;

export function parseArgs(argv: readonly string[]): Args | { error: string } {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) return { error: `đối số lạ: ${a}` };
    const k = a.slice(2);
    if (BOOL_FLAGS.has(k)) out[k] = true;
    else if (VALUE_FLAGS.has(k)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return { error: `--${k} cần giá trị` };
      out[k] = v;
    } else return { error: `cờ lạ: --${k}` };
  }
  return out;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

export type CliDeps = {
  dir?: string;
  /** Nhà cung cấp live (mặc định dựng từ env của Hub). Test tiêm giả. */
  provider?: () => ModelProvider | null | Promise<ModelProvider | null>;
};

export type CliResult = { code: number; stdout: string; stderr: string };

async function defaultProvider(): Promise<ModelProvider | null> {
  // nạp muộn: replay không kéo AI client/CLI
  const { envProviderRouter } = await import("../../apps/hub-api/src/lib/ai-client/ai-client.env");
  return envProviderRouter(process.env).pick("hub.eval");
}

const fail = (stderr: string): CliResult => ({ code: 2, stdout: "", stderr });

type Source = {
  src: ReturnType<typeof replaySource>;
  recording?: ReturnType<typeof recordingSource>;
  costNote?: string;
};

/** Live: ước tính chi phí in TRƯỚC, không có `--yes` thì dừng (không gọi model). */
async function liveSetup(
  args: Args,
  cases: EvalCase[],
  fx: Fixtures,
  deps: CliDeps,
): Promise<Source | CliResult> {
  const model = (args.model as string | undefined) ?? "claude-sonnet-5-5";
  const judgeModel = (args["judge-model"] as string | undefined) ?? "claude-haiku-5-5";
  const provider = await (deps.provider ?? defaultProvider)();
  if (!provider)
    return fail(
      "live: chưa cấu hình nhà cung cấp AI (AI_PROVIDER / ANTHROPIC_API_KEY / CLI claude)\n",
    );
  const costNote = formatEstimate(
    estimateCost(cases, fx, model, judgeModel),
    provider.billing ?? "api",
  );
  if (args.yes !== true)
    return fail(`${costNote}\nChưa chạy. Thêm --yes để chạy live (tốn tiền/hạn mức).\n`);
  const live = liveSource(provider, fx, model, judgeModel);
  if (!args.record) return { src: live, costNote };
  const recording = recordingSource(live, model);
  return { src: recording, recording, costNote };
}

export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<CliResult> {
  const args = parseArgs(argv);
  if ("error" in args) return fail(`${args.error}\n`);
  const dir = deps.dir ?? EVAL_DIR;
  const mode = (args.mode ?? "replay") as string;
  if (mode !== "replay" && mode !== "live") return fail("--mode phải là replay|live\n");
  const threshold = args.threshold === undefined ? DEFAULT_THRESHOLD : Number(args.threshold);
  if (!Number.isFinite(threshold) || threshold < 0) return fail("--threshold không hợp lệ\n");

  const fx = readJson<Fixtures>(join(dir, "fixtures.json"));
  const cases = filterCases(
    readJson<EvalCase[]>(join(dir, "cases.json")),
    args.filter as string | undefined,
  );
  if (cases.length === 0) return fail("bộ lọc không khớp ca nào\n");

  const s: Source | CliResult =
    mode === "replay"
      ? { src: replaySource(readJson<Recorded>(join(dir, "recorded.replay.json"))) }
      : await liveSetup(args, cases, fx, deps);
  if ("code" in s) return s;
  const { src, recording, costNote } = s;
  const stderr = costNote ? `${costNote}\n` : "";

  const report: Report = await runEval(mode, cases, src.respond, src.judge);
  return finish(args, report, threshold, stderr, recording, costNote);
}

function finish(
  args: Args,
  report: Report,
  threshold: number,
  stderr: string,
  recording?: Source["recording"],
  costNote?: string,
): CliResult {
  if (recording && typeof args.record === "string") {
    writeFileSync(args.record, `${JSON.stringify(recording.recorded, null, 2)}\n`);
  }
  if (typeof args["write-baseline"] === "string") {
    writeFileSync(args["write-baseline"], `${JSON.stringify(toBaseline(report), null, 2)}\n`);
  }
  const diff =
    typeof args.baseline === "string"
      ? diffBaseline(report, readJson<Baseline>(args.baseline), threshold)
      : undefined;
  const extra = {
    threshold,
    ...(diff ? { diff } : {}),
    ...(costNote ? { estimate: costNote } : {}),
  };
  const stdout =
    args.json === true
      ? `${JSON.stringify({ ...report, ...extra })}\n`
      : `${summarize(report, diff)}\n`;
  return { code: diff?.regression ? 1 : 0, stdout, stderr };
}
