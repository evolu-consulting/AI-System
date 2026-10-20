// ai-sub · `ModelProvider` chạy trên GÓI Claude (Claude Code CLI đã đăng nhập gói, không khoá API): MỘT lượt `claude -p
// --output-format json`, không tool, không MCP, không lưu phiên, không nạp cấu hình/CLAUDE.md (`--setting-sources ""`), cwd = thư mục tạm. Lời nhắc qua stdin; trần output qua env
// `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (= phần token được cấp). Env con là danh sách TRẮNG: không bao giờ chuyển `ANTHROPIC_API_KEY`/
// `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL` (có khoá ⇒ CLI tính tiền API thay vì gói). Đăng nhập gói nằm ở thư mục cấu hình CLI
// của user chạy hub-api (`CLAUDE_CONFIG_DIR` nếu đặt, không thì `~/.claude`) — xem docs/specs/ai-sub/tasks.md.
// `billing = subscription` ⇒ dòng usage `subscription`, chi phí 0. Chưa đăng nhập ⇒ `UNAVAILABLE`. Huỷ giữa chừng ⇒ không có usage
// (CLI chỉ báo usage khi xong). Chạy CLI qua seam `CliRun` (test dùng runner giả — không AI thật).
import { tmpdir } from "node:os";
import type { AiUsage, ModelProvider, ModelReply } from "./ai-client";

export type CliOutput = { exitCode: number | null; stdout: string; stderr: string };
export type CliRun = (
  argv: string[],
  o: { stdin: string; env: Record<string, string>; cwd: string; signal: AbortSignal },
) => Promise<CliOutput>;

export type ClaudeCliOptions = {
  /** Đường dẫn CLI (`AI_SUB_CLI_PATH`, mặc định `claude` trên PATH). */
  cliPath: string;
  /** Thư mục đăng nhập/cấu hình CLI (`AI_SUB_CLAUDE_CONFIG_DIR`); vắng ⇒ `~/.claude` của user tiến trình. */
  configDir?: string;
  /** Số lượt CLI chạy cùng lúc trong tiến trình (gói có giới hạn; mặc định 2). */
  maxConcurrency?: number;
  /** Env tiến trình để lấy biến TRẮNG (HOME, PATH, …); mặc định `process.env`. */
  env?: Record<string, string | undefined>;
  run?: CliRun;
  /** Khoá provider ghi vào `usage_logs.provider_key` (mặc định `claude-sub`, trùng provider gói của Studio). */
  key?: string;
};

/** Giới hạn độ dài một đối số argv (Linux MAX_ARG_STRLEN 128 KiB, chừa biên). */
export const SYSTEM_ARG_MAX = 100_000;
const BASE_ENV = [
  "HOME",
  "PATH",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemRoot",
];
const AUTH_RE = /\/login|not logged in|log in|authenticat|oauth|invalid api key|credential/i;

export function cliArgs(model: string, system: string): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--max-turns",
    "1",
    "--system-prompt",
    system,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];
}

/** Env con: chỉ biến trắng + cấu hình CLI tĩnh. Không biến khoá/URL Anthropic nào lọt qua. */
export function cliEnv(
  src: Record<string, string | undefined>,
  o: { configDir?: string; maxTokens: number },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of BASE_ENV) {
    const v = src[k];
    if (v) env[k] = v;
  }
  if (o.configDir) env.CLAUDE_CONFIG_DIR = o.configDir;
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(Math.max(1, Math.floor(o.maxTokens)));
  env.DISABLE_AUTOUPDATER = "1";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  return env;
}

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};
type CliResult = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  usage?: RawUsage;
  modelUsage?: Record<string, { outputTokens?: number }>;
};
const n = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const usageOf = (u: RawUsage | undefined): AiUsage => ({
  inputTokens: n(u?.input_tokens),
  outputTokens: n(u?.output_tokens),
  cacheReadTokens: n(u?.cache_read_input_tokens),
  cacheWriteTokens: n(u?.cache_creation_input_tokens),
});
/** Model thật đã trả lời = model có nhiều token output nhất trong `modelUsage` (vắng ⇒ model yêu cầu). */
function modelOf(r: CliResult, asked: string): string {
  const entries = Object.entries(r.modelUsage ?? {});
  if (entries.length === 0) return asked;
  entries.sort((a, b) => n(b[1].outputTokens) - n(a[1].outputTokens));
  return entries[0]?.[0] ?? asked;
}

/** Kết quả CLI → `ModelReply` (thuần). JSON hỏng/không có ⇒ `FAILED` (hoặc `UNAVAILABLE` nếu stderr báo chưa đăng nhập). */
export function replyOf(out: CliOutput, askedModel: string): ModelReply {
  let r: CliResult | null = null;
  try {
    const parsed = JSON.parse(out.stdout.trim()) as unknown;
    if (parsed && typeof parsed === "object") r = parsed as CliResult;
  } catch {
    r = null;
  }
  if (!r || r.type !== "result")
    return { ok: false, code: AUTH_RE.test(out.stderr) ? "UNAVAILABLE" : "FAILED" };
  const usage = usageOf(r.usage);
  const model = modelOf(r, askedModel);
  if (r.is_error || r.subtype !== "success" || out.exitCode !== 0) {
    const code = AUTH_RE.test(`${r.result ?? ""}\n${out.stderr}`) ? "UNAVAILABLE" : "FAILED";
    return { ok: false, code, model, usage };
  }
  return { ok: true, text: r.result ?? "", model, usage };
}

/** Runner thật: `Bun.spawn`, stdin = lời nhắc, huỷ theo `signal` (SIGTERM). */
export const bunCliRun: CliRun = async (argv, o) => {
  const proc = Bun.spawn(argv, {
    cwd: o.cwd,
    env: o.env,
    stdin: new Blob([o.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    signal: o.signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

/** Hàng đợi đơn giản giới hạn số lượt chạy cùng lúc; huỷ khi đang chờ ⇒ ném (người gọi trả `FAILED`). */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> => {
    if (signal.aborted) throw new Error("aborted");
    if (active >= max)
      await new Promise<void>((resolve, reject) => {
        const go = () => {
          signal.removeEventListener("abort", stop);
          resolve();
        };
        const stop = () => {
          const i = waiting.indexOf(go);
          if (i >= 0) waiting.splice(i, 1);
          reject(new Error("aborted"));
        };
        waiting.push(go);
        signal.addEventListener("abort", stop, { once: true });
      });
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

export function claudeCliProvider(o: ClaudeCliOptions): ModelProvider {
  const run = o.run ?? bunCliRun;
  const src = o.env ?? process.env;
  const gate = limiter(Math.max(1, o.maxConcurrency ?? 2));
  return {
    key: o.key ?? "claude-sub",
    billing: "subscription",
    async complete(r): Promise<ModelReply> {
      if (r.system.length > SYSTEM_ARG_MAX) return { ok: false, code: "FAILED" };
      try {
        const out = await gate(r.signal, () =>
          run([o.cliPath, ...cliArgs(r.model, r.system)], {
            stdin: r.prompt,
            env: cliEnv(src, {
              ...(o.configDir ? { configDir: o.configDir } : {}),
              maxTokens: r.maxTokens,
            }),
            cwd: tmpdir(),
            signal: r.signal,
          }),
        );
        return replyOf(out, r.model);
      } catch {
        return { ok: false, code: "FAILED" };
      }
    },
  };
}
