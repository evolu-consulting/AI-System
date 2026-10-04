// HUB-NFR-04 · H1-R26 · log JSON một dòng có `request_id`, `run_id`, `tenant_id`, `user_id`.
// Không log secret/JWT/nội dung tin (A52): che theo tên key và theo giá trị trông như JWT/Bearer.
export type Level = "debug" | "info" | "warn" | "error" | "fatal";
export type LogFields = Record<string, unknown>;
export type LogContext = {
  request_id?: string;
  run_id?: string;
  tenant_id?: string;
  user_id?: string;
};

const SENSITIVE_KEY = /pass|secret|token|key|authorization|cookie|jwt|content|prompt|body|text/i;
const JWT_LIKE = /eyJ[\w-]*\.[\w-]+\.[\w-]*|Bearer\s+\S+/g;
const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
// Dưới `bun test` bỏ log debug/info cho gọn; server gọi setMinLevel(LOG_LEVEL).
let minLevel: Level = Bun.env.NODE_ENV === "test" ? "warn" : "info";
let sink: (level: Level, line: string) => void = (level, line) => {
  if (RANK[level] < RANK.warn) console.log(line);
  else console.error(line);
};

export function setMinLevel(level: Level): void {
  minLevel = level;
}

/** Thay nơi ghi (test bắt dòng log). Trả hàm khôi phục. */
export function setSink(fn: (level: Level, line: string) => void): () => void {
  const prev = sink;
  sink = fn;
  return () => {
    sink = prev;
  };
}

function scrub(v: unknown): unknown {
  return typeof v === "string" ? v.replace(JWT_LIKE, "[redacted]") : v;
}

export function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrub(v);
  }
  return out;
}

export type Logger = { [L in Level]: (msg: string, fields?: LogFields) => void } & {
  child: (ctx: LogContext) => Logger;
};

function make(ctx: LogContext): Logger {
  const write =
    (level: Level) =>
    (msg: string, fields: LogFields = {}): void => {
      if (RANK[level] < RANK[minLevel]) return;
      const rec = {
        level,
        time: new Date().toISOString(),
        msg: scrub(msg),
        ...redact({ ...ctx, ...fields }),
      };
      sink(level, JSON.stringify(rec));
    };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    fatal: write("fatal"),
    child: (extra) => make({ ...ctx, ...extra }),
  };
}

export const logger: Logger = make({});
