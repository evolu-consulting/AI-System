// CR-114 hub-otel · `bun run log:view`: đọc log kv (hub-api / agent-runtime, `LOG_FORMAT=kv`) và in cho người đọc.
// Thuần: `parseKv` (tách `key=value`, giá trị trong ngoặc kép có escape) + `prettyLine` (giờ, mức, sự kiện, cột id).
export type KvRecord = Record<string, string>;

const KV_HEAD = /^t=\d+ lvl=\w+ e=\S+/;

/** Dòng kv hợp lệ? (khác JSON/log lạ ⇒ in nguyên). */
export const isKvLine = (line: string): boolean => KV_HEAD.test(line);

/** `a=1 b="x y" c="q\"z"` → `{a:"1", b:"x y", c:'q"z'}`. Khoá không có `=` bị bỏ. */
export function parseKv(line: string): KvRecord {
  const out: KvRecord = {};
  for (const m of line.matchAll(PAIR)) {
    const [, key, raw] = m;
    if (key !== undefined && raw !== undefined) out[key] = raw.startsWith('"') ? unquote(raw) : raw;
  }
  return out;
}

const PAIR = /([^\s="]+)=("(?:[^"\\]|\\.)*"|\S*)/g;
const UNESCAPE: Record<string, string> = { n: "\n", r: "\r", t: "\t" };

/** `"a \"b\"\n"` → `a "b"` + xuống dòng (đối xứng `kvValue` của hub-api / `kv_value` của Runtime). */
const unquote = (raw: string): string =>
  raw.slice(1, -1).replace(/\\(.)/g, (_m, c: string) => UNESCAPE[c] ?? c);

const LEVEL_COLOR: Record<string, string> = {
  debug: "\x1b[90m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  warning: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m",
};
const RESET = "\x1b[0m";
const HEAD_KEYS = new Set(["t", "lvl", "e"]);
/** Cột đứng đầu theo thứ tự cố định (nếu có) để mắt quét theo cột. */
const COLUMNS = ["run", "ag", "ms", "tk", "trace"] as const;

export type PrettyOpts = { color?: boolean; utc?: boolean };

const pad2 = (n: number) => String(n).padStart(2, "0");

export function clock(epochS: number, utc = false): string {
  const d = new Date(epochS * 1000);
  return utc
    ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
    : `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** `12:00:03 INFO  run.finished  run=0a1b2c ag=contract-reviewer ms=1235 tk=120/45 trace=abcdef01  seq=3`. */
export function prettyLine(line: string, o: PrettyOpts = {}): string {
  if (!isKvLine(line)) return line;
  const r = parseKv(line);
  const lvl = (r.lvl ?? "info").toLowerCase();
  const paint = o.color ? (LEVEL_COLOR[lvl] ?? "") : "";
  const reset = paint ? RESET : "";
  const cols = COLUMNS.filter((k) => r[k] !== undefined).map((k) => `${k}=${r[k]}`);
  const rest = Object.entries(r)
    .filter(([k]) => !HEAD_KEYS.has(k) && !(COLUMNS as readonly string[]).includes(k))
    .map(([k, v]) => `${k}=${/[\s=]/.test(v) ? JSON.stringify(v) : v}`);
  const time = clock(Number(r.t), o.utc);
  const head = `${time} ${paint}${lvl.toUpperCase().padEnd(5)}${reset} ${r.e ?? ""}`;
  return [head, ...cols, ...(rest.length > 0 ? ["", ...rest] : [])].join(" ").replace(/ {2,}$/, "");
}
