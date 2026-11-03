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

/** Khoá id đầy đủ → khoá ngắn của kv (giá trị rút 6 ký tự). */
const JSON_IDS: Record<string, string> = {
  run_id: "run",
  job_id: "job",
  tenant_id: "tn",
  user_id: "usr",
  request_id: "req",
  step_id: "step",
};
const JSON_HEAD = new Set([
  "level",
  "time",
  "ts",
  "msg",
  "event",
  "agent",
  "agent_key",
  "ms",
  "duration_ms",
  "latency_ms",
]);
const TOKEN_KEYS = new Set(["input_tokens", "output_tokens"]);

const eventOf = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ".")
    .replace(/^\.|\.$/g, "") || "log";
const text = (v: unknown): string => (typeof v === "string" ? v : (JSON.stringify(v) ?? ""));

type Obj = Record<string, unknown>;

function parseJson(line: string): Obj | null {
  if (!line.startsWith("{")) return null;
  try {
    return JSON.parse(line) as Obj;
  } catch {
    return null;
  }
}

/** Các cột đầu (id rút 6 ký tự, agent, ms, tk) của log JSON. */
function jsonColumns(o: Obj): KvRecord {
  const r: KvRecord = {};
  for (const [long, short] of Object.entries(JSON_IDS))
    if (o[long] != null) r[short] = text(o[long]).slice(0, 6);
  const ag = o.agent ?? o.agent_key;
  if (ag != null) r.ag = text(ag);
  const dur = o.ms ?? o.duration_ms ?? o.latency_ms;
  if (typeof dur === "number") r.ms = String(Math.round(dur));
  if (typeof o.input_tokens === "number" || typeof o.output_tokens === "number")
    r.tk = `${o.input_tokens ?? 0}/${o.output_tokens ?? 0}`;
  return r;
}

const isRestKey = (k: string): boolean =>
  !JSON_HEAD.has(k) && !(k in JSON_IDS) && !TOKEN_KEYS.has(k);

/** Log JSON của hub-api (`{level,time,msg,…}`) hoặc Runtime (`{level,ts,event,…}`) → cùng bản ghi như kv; không phải ⇒ null. */
export function jsonToRecord(line: string): KvRecord | null {
  const o = parseJson(line);
  const msg = o?.msg ?? o?.event;
  if (!o || typeof o.level !== "string" || typeof msg !== "string") return null;
  const t = Math.floor(Date.parse(text(o.time ?? o.ts)) / 1000);
  const rest = Object.entries(o).filter(([k, v]) => isRestKey(k) && v != null);
  return {
    t: String(t),
    lvl: o.level,
    e: eventOf(msg),
    ...jsonColumns(o),
    ...Object.fromEntries(rest.map(([k, v]) => [k, text(v)])),
  };
}
/** Bản ghi của một dòng log kv hoặc JSON; dòng lạ ⇒ null. */
export const recordOf = (line: string): KvRecord | null =>
  isKvLine(line) ? parseKv(line) : jsonToRecord(line);

/** `12:00:03 INFO  run.finished  run=0a1b2c ag=contract-reviewer ms=1235 tk=120/45 trace=abcdef01  seq=3`. Nhận cả JSON. */
export function prettyLine(line: string, o: PrettyOpts = {}): string {
  const r = recordOf(line);
  if (!r) return line;
  const lvl = (r.lvl ?? "info").toLowerCase();
  const paint = o.color ? (LEVEL_COLOR[lvl] ?? "") : "";
  const reset = paint ? RESET : "";
  const cols = COLUMNS.filter((k) => r[k] !== undefined).map((k) => `${k}=${r[k]}`);
  const rest = Object.entries(r)
    .filter(([k]) => !HEAD_KEYS.has(k) && !(COLUMNS as readonly string[]).includes(k))
    .map(([k, v]) => `${k}=${/[\s=]/.test(v) ? JSON.stringify(v) : v}`);
  const time = Number.isFinite(Number(r.t)) ? clock(Number(r.t), o.utc) : "--:--:--";
  const head = `${time} ${paint}${lvl.toUpperCase().padEnd(5)}${reset} ${r.e ?? ""}`;
  return [head, ...cols, ...(rest.length > 0 ? ["", ...rest] : [])].join(" ").replace(/ {2,}$/, "");
}
