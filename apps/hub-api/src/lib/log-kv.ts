// CR-114 hub-otel · định dạng log gọn cho agent đọc (`LOG_FORMAT=kv`): một dòng `key=value`, đo ~59% token ít hơn JSON mà
// hiểu đúng như nhau. `t=<epoch s> lvl=info e=<dotted.event> run=<6 ký tự> ag=<tên agent đầy đủ> ms=<n> tk=<in>/<out>
// trace=<8 ký tự> …`. Tên sự kiện là chữ (không mã số); id rút 6 ký tự (id đầy đủ nằm trong DB); giá trị chỉ số/chữ, chuỗi
// chỉ đặt trong ngoặc kép khi có khoảng trắng/`=`/`"`; dòng ≤ 400 ký tự. Che bí mật: hàm `redact` do logger truyền vào.
export type LogFields = Record<string, unknown>;

export const KV_MAX_LINE = 400;
const ID_LEN = 6;

/** Khoá có id đầy đủ → khoá ngắn (giá trị rút 6 ký tự). */
const ID_ALIASES: Record<string, string> = {
  run_id: "run",
  job_id: "job",
  tenant_id: "tn",
  user_id: "usr",
  request_id: "req",
  step_id: "step",
};
const AGENT_KEYS = ["agent", "agent_key", "agent_name"];
const MS_KEYS = ["ms", "duration_ms", "latency_ms"];
const NEEDS_QUOTE = /[\s="\\]/;

const shortId = (v: unknown): string => String(v).slice(0, ID_LEN);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `job-enqueue-skipped` / `run started` → `job.enqueue.skipped` / `run.started`. */
export function eventName(msg: string): string {
  const e = msg
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.|\.$/g, "");
  return e === "" ? "log" : e.slice(0, 64);
}

const keyName = (k: string): string => k.toLowerCase().replace(/[^a-z0-9_.-]/g, "_");

const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/** Ký tự điều khiển (< 0x20) — kiểm bằng mã ký tự, không regex. */
const isCtl = (c: string): boolean => c.charCodeAt(0) < 32;

function scalarText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null))
    return v.map((x) => String(x)).join(",");
  return JSON.stringify(v) ?? "";
}

export function kvValue(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  const s = scalarText(v);
  if (s !== "" && !NEEDS_QUOTE.test(s) && ![...s].some(isCtl)) return s;
  const esc = [...s].map((c) => ESCAPES[c] ?? (isCtl(c) ? "" : c)).join("");
  return `"${esc}"`;
}

export type KvInput = {
  level: string;
  msg: string;
  /** Trường thô (chưa che) — `tk`/`ms`/id/agent rút ra trước khi che vì khoá `*token*` bị `redact` thay hẳn. */
  fields: LogFields;
  now?: number;
  trace?: string | undefined;
};

type Redact = (f: LogFields) => LogFields;
type Pair = [string, unknown];

function pickFirst(f: LogFields, keys: readonly string[]): unknown {
  for (const k of keys) if (f[k] !== undefined && f[k] !== null) return f[k];
  return undefined;
}

/** Rút id/agent/ms/tk khỏi `f` (xoá khỏi `f`), theo thứ tự cố định. */
function headline(f: LogFields, redact: Redact): Pair[] {
  const out: Pair[] = [];
  for (const [long, short] of Object.entries(ID_ALIASES)) {
    if (f[long] !== undefined) out.push([short, shortId(f[long])]);
    delete f[long];
  }
  const ag = pickFirst(f, AGENT_KEYS);
  if (ag !== undefined) out.push(["ag", redact({ agent: ag }).agent]);
  const ms = pickFirst(f, MS_KEYS);
  if (isNum(ms)) out.push(["ms", Math.round(ms)]);
  const tin = f.input_tokens ?? f.tk_in;
  const tout = f.output_tokens ?? f.tk_out;
  if (isNum(tin) || isNum(tout))
    out.push(["tk", `${isNum(tin) ? tin : 0}/${isNum(tout) ? tout : 0}`]);
  for (const k of [...AGENT_KEYS, ...MS_KEYS, "input_tokens", "output_tokens", "tk_in", "tk_out"])
    delete f[k];
  return out;
}

export function formatKv(i: KvInput, redact: Redact): string {
  const f = { ...i.fields };
  const pairs: Pair[] = [
    ["t", Math.floor((i.now ?? Date.now()) / 1000)],
    ["lvl", i.level],
    ["e", eventName(redact({ msg: i.msg }).msg as string)],
    ...headline(f, redact),
    ["trace", i.trace?.slice(0, 8)],
    ...Object.entries(redact(f)).map(
      ([k, v]): Pair => [keyName(k), k.endsWith("_id") && typeof v === "string" ? shortId(v) : v],
    ),
  ];
  const line = pairs
    .flatMap(([k, v]) => {
      const s = kvValue(v);
      return s === null ? [] : [`${k}=${s}`];
    })
    .join(" ");
  return line.length > KV_MAX_LINE ? `${line.slice(0, KV_MAX_LINE - 1)}~` : line;
}
