// CR-114 hub-eval · đo token + mức hiểu của model trên 4 khuôn log, qua `claude -p` (gói Claude CLI; tốn hạn mức).
// token log = (input + cache_creation + cache_read) của lời gọi với log trừ lời gọi với log rỗng (cùng câu hỏi).
import { costUsd } from "../../../apps/hub-api/src/lib/ai-client/pricing";
import { type Dataset, FORMATS, type FormatName, generate, gradeAnswer } from "./generate";

export type Call = { tokensIn: number; text: string; ms: number };
/** Gọi model; test tiêm hàm giả. */
export type CallFn = (model: string, prompt: string) => Promise<Call>;

export type Row = {
  model: string;
  format: FormatName;
  logTokens: number;
  correct: number;
  total: number;
  secPerRun: number;
};

const SYSTEM = "You answer precisely.";

export function claudeCall(cliPath: string): CallFn {
  return async (model, prompt) => {
    const p = Bun.spawn(
      [
        cliPath,
        "-p",
        "--model",
        model,
        "--output-format",
        "json",
        "--system-prompt",
        SYSTEM,
        "--disallowedTools",
        "*",
      ],
      { stdin: new Blob([prompt]), stdout: "pipe", stderr: "ignore" },
    );
    const out = await new Response(p.stdout).text();
    await p.exited;
    const j = JSON.parse(out) as {
      result?: string;
      duration_ms?: number;
      usage?: {
        input_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    const u = j.usage ?? {};
    return {
      tokensIn:
        (u.input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0),
      text: j.result ?? "",
      ms: j.duration_ms ?? 0,
    };
  };
}

export type MeasureOpts = { complex: boolean; models: string[]; reps: number };

/** Số lời gọi model của một lần đo (in trước khi chạy). */
export const plannedCalls = (o: MeasureOpts): number =>
  o.models.length * (1 + FORMATS.length * o.reps);

export async function measure(
  o: MeasureOpts,
  call: CallFn,
  ds: Dataset = generate(o.complex),
): Promise<Row[]> {
  const rows: Row[] = [];
  for (const model of o.models) {
    const base = (await call(model, `${ds.question}\n\n(empty)`)).tokensIn;
    for (const f of FORMATS) {
      let correct = 0;
      let tokens = 0;
      let ms = 0;
      for (let i = 0; i < o.reps; i++) {
        const r = await call(model, `${ds.question}\n\n${ds.formats[f]}`);
        tokens = r.tokensIn - base;
        ms += r.ms;
        correct += gradeAnswer(ds, r.text).correct;
      }
      rows.push({
        model,
        format: f,
        logTokens: tokens,
        correct,
        total: (ds.scalarKeys.length + 1) * o.reps,
        secPerRun: Math.round((ms / o.reps / 1000) * 10) / 10,
      });
    }
  }
  return rows;
}

export const formatRows = (rows: readonly Row[]): string =>
  rows
    .map(
      (r) =>
        `${r.model.padEnd(7)} ${r.format.padEnd(12)} log_tokens=${String(r.logTokens).padStart(6)}  dung=${r.correct}/${r.total}  ${r.secPerRun.toFixed(1)}s/lan`,
    )
    .join("\n");

const CHARS_PER_TOKEN = 3.5;
const OUT_TOKENS = 150;
const MODEL_IDS: Record<string, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export type MeasureEstimate = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
};

/** Ước tính trước khi chạy: mỗi lời gọi ≈ (câu hỏi + log)/3,5 token vào, ~150 token ra; USD theo giá API (bí danh haiku/sonnet/opus). */
export function estimateMeasure(
  o: MeasureOpts,
  ds: Dataset = generate(o.complex),
): MeasureEstimate {
  const q = Math.ceil(ds.question.length / CHARS_PER_TOKEN);
  const logs = FORMATS.reduce((s, f) => s + Math.ceil(ds.formats[f].length / CHARS_PER_TOKEN), 0);
  const perModelIn = q + o.reps * (FORMATS.length * q + logs);
  const perModelOut = OUT_TOKENS * (1 + FORMATS.length * o.reps);
  let usd: number | null = 0;
  for (const m of o.models) {
    const c = costUsd(MODEL_IDS[m] ?? m, {
      inputTokens: perModelIn,
      outputTokens: perModelOut,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    usd = usd === null || c === null ? null : usd + c;
  }
  return {
    calls: plannedCalls(o),
    inputTokens: perModelIn * o.models.length,
    outputTokens: perModelOut * o.models.length,
    usd: usd === null ? null : Math.round(usd * 10_000) / 10_000,
  };
}

export function formatEstimate(e: MeasureEstimate): string {
  const usd = e.usd === null ? "model chưa có trong bảng giá" : `~$${e.usd.toFixed(4)} (giá API)`;
  return `Ước tính: ${e.calls} lời gọi \`claude -p\`, ~${e.inputTokens} token vào + ~${e.outputTokens} ra, ${usd}; gói Claude: tốn hạn mức gói`;
}
