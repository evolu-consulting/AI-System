// ADM-NFR-06 · log JSON một dòng; che giá trị của key nhạy cảm (CONVENTIONS §5).
type Level = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const SENSITIVE = /pass|secret|token|key|authorization|cookie/i;
const RANK: Record<Level, number> = { info: 0, warn: 1, error: 2 };
// Dưới `bun test` (NODE_ENV=test) bỏ log info để đầu ra test gọn; warn/error vẫn in.
// Tiến trình server đặt lại "info" (con của `bun test` thừa hưởng NODE_ENV=test nhưng vẫn phải log request).
let MIN_LEVEL: Level = Bun.env.NODE_ENV === "test" ? "warn" : "info";

export function setMinLevel(level: Level): void {
  MIN_LEVEL = level;
}

export function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  return out;
}

function write(level: Level, msg: string, fields: LogFields = {}): void {
  if (RANK[level] < RANK[MIN_LEVEL]) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...redact(fields) });
  if (level === "info") console.log(line);
  else console.error(line);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
