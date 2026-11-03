// CR-116 probe · luật thuần của `bun run perf:probe|perf:baseline|perf:compare`: đọc dòng kv `e=probe.*` từ log evotest,
// gom p50/p95/mean theo probe, so với baseline có chặn nhiễu. Không I/O (CLI ở `perf-probe.ts`).

export type Kv = Record<string, string>;
export type Sample = { ms: number; cpu: number; rss: number; sql: number; rt: number };
export type Pct = { p50: number; p95: number; mean: number };
export type ProbeStat = Pct & {
  /** Số mẫu (mọi lượt) */
  n: number;
  /** Trung vị mỗi lượt-trung-vị: sql/rt (câu, round trip mỗi lần gọi), cpu ms, rss KiB */
  sql: number;
  rt: number;
  cpu: number;
  rss: number;
  /** (max-min)/median của p50 qua các lượt, % — thước đo nhiễu */
  spread: number;
};
export type ScnStat = { ms: number; cpu: number; rss: number; conns: number };
export type Baseline = {
  scenario: string;
  commit: string;
  date: string;
  env: { pg: string; cpus: string; exclusive: boolean };
  size: string;
  runs: number;
  scn: ScnStat;
  probes: Record<string, ProbeStat>;
};

export const MIN_RUNS = 3;
export const REGRESS_PCT = 10;
export const WIN_PCT = 20;

/** `k=v k="a b"` → map. */
export function parseKv(s: string): Kv {
  const o: Kv = {};
  for (const m of s.matchAll(/([a-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
    const raw = m[2] ?? "";
    o[m[1] as string] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
  }
  return o;
}

const LINE = /\bt=\d+ e=probe\.\S+/;
const num = (v: string | undefined): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export type Parsed = {
  meta: Record<string, Kv>;
  /** scenario → lượt → mẫu probe */
  runs: Record<string, Map<number, Record<string, Sample[]>>>;
  ends: Record<string, Map<number, Kv>>;
};

/** Đọc log (console của evotest, có thể lẫn tiền tố/nhiễu); mẫu chỉ tính giữa `scenario.start` và `scenario.end`. */
export function parseProbeLog(text: string): Parsed {
  const out: Parsed = { meta: {}, runs: {}, ends: {} };
  let cur: Cur = null;
  for (const line of text.split(/\r?\n/)) {
    const at = line.search(LINE);
    if (at >= 0) cur = applyLine(out, cur, parseKv(line.slice(at)));
  }
  return out;
}

type Cur = { scn: string; r: number } | null;

function getOrInit<V>(m: Map<number, V>, k: number, mk: () => V): V {
  const have = m.get(k);
  if (have) return have;
  const v = mk();
  m.set(k, v);
  return v;
}
function mapOf<V>(o: Record<string, Map<number, V>>, k: string): Map<number, V> {
  const have = o[k];
  if (have) return have;
  const m = new Map<number, V>();
  o[k] = m;
  return m;
}

/** Áp một dòng probe vào kết quả; trả `cur` mới (lượt đang mở). */
function applyLine(out: Parsed, cur: Cur, kv: Kv): Cur {
  const e = (kv.e ?? "").slice("probe.".length);
  const scn = kv.scn ?? "";
  if (e === "meta") out.meta[scn] = kv;
  else if (e === "scenario.start") {
    mapOf(out.runs, scn).set(num(kv.r), {});
    return { scn, r: num(kv.r) };
  } else if (e === "scenario.end") {
    mapOf(out.ends, scn).set(num(kv.r), kv);
    return null;
  } else if (cur) {
    const by = getOrInit(mapOf(out.runs, cur.scn), cur.r, () => ({}));
    const s: Sample = {
      ms: num(kv.ms),
      cpu: num(kv.cpu),
      rss: num(kv.rss),
      sql: num(kv.sql),
      rt: num(kv.rt),
    };
    by[e] = [...(by[e] ?? []), s];
  }
  return cur;
}

export function pctile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] as number;
}
const med = (xs: readonly number[]): number => pctile(xs, 50);
const r1 = (x: number): number => Math.round(x * 10) / 10;

/** p50/p95/mean gộp mọi mẫu + spread của p50 theo lượt. */
export function aggregateProbe(perRun: readonly Sample[][]): ProbeStat {
  const all = perRun.flat();
  const ms = all.map((s) => s.ms);
  const p50s = perRun.filter((r) => r.length > 0).map((r) => med(r.map((s) => s.ms)));
  const m = med(p50s);
  return {
    n: all.length,
    p50: r1(pctile(ms, 50)),
    p95: r1(pctile(ms, 95)),
    mean: r1(ms.reduce((a, x) => a + x, 0) / Math.max(1, ms.length)),
    sql: r1(med(all.map((s) => s.sql))),
    rt: r1(med(all.map((s) => s.rt))),
    cpu: r1(med(all.map((s) => s.cpu))),
    rss: Math.round(med(all.map((s) => s.rss))),
    spread: m > 0 && p50s.length > 1 ? r1(((Math.max(...p50s) - Math.min(...p50s)) / m) * 100) : 0,
  };
}

/** Gom một kịch bản (đã parse) thành baseline-không-metadata. */
export function aggregateScenario(
  p: Parsed,
  scn: string,
): Pick<Baseline, "runs" | "scn" | "probes" | "size"> & { pg: string } {
  const runs = [...(p.runs[scn]?.entries() ?? [])].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const names = new Set(runs.flatMap((r) => Object.keys(r)));
  const probes: Record<string, ProbeStat> = {};
  for (const n of [...names].sort()) probes[n] = aggregateProbe(runs.map((r) => r[n] ?? []));
  const ends = [...(p.ends[scn]?.values() ?? [])];
  const e = (k: string) => med(ends.map((x) => num(x[k])));
  return {
    runs: runs.length,
    size: p.meta[scn]?.size ?? "small",
    pg: p.meta[scn]?.pg ?? "?",
    scn: { ms: e("ms"), cpu: e("cpu"), rss: e("rss"), conns: e("conns") },
    probes,
  };
}

export type Row = {
  name: string;
  base: { p50: number; p95: number } | null;
  now: { p50: number; p95: number } | null;
  dPct: number | null;
  dSql: number | null;
  /** noise: |Δ| ≤ nhiễu đo được (spread hai bên) ⇒ không kết luận */
  flag: "REGRESSION" | "win" | "noise" | "new" | "gone" | "ok";
  spread: number;
};
export type Cmp = { rows: Row[]; regressed: boolean; error?: string };

/** So `now` với `base`: cần ≥ MIN_RUNS lượt mỗi bên; kết luận chỉ khi |Δ| vượt nhiễu (spread lớn nhất của hai bên). */
export function compare(base: Baseline, now: Baseline): Cmp {
  if (now.runs < MIN_RUNS || base.runs < MIN_RUNS)
    return {
      rows: [],
      regressed: false,
      error: `cần ≥ ${MIN_RUNS} lượt mỗi bên (base ${base.runs}, now ${now.runs})`,
    };
  const names = new Set([...Object.keys(base.probes), ...Object.keys(now.probes)]);
  const rows = [...names].map((name) => compareOne(name, base.probes[name], now.probes[name]));
  return { rows, regressed: rows.some((r) => r.flag === "REGRESSION") };
}

const pq = (s: ProbeStat | undefined) => (s ? { p50: s.p50, p95: s.p95 } : null);

function flagOf(dPct: number, sqlPct: number, spread: number): Row["flag"] {
  if (sqlPct > REGRESS_PCT) return "REGRESSION"; // số câu SQL tất định ⇒ không cần chặn nhiễu
  if (Math.abs(dPct) <= spread && Math.abs(dPct) > REGRESS_PCT) return "noise";
  if (dPct > REGRESS_PCT) return "REGRESSION";
  return dPct < -WIN_PCT ? "win" : "ok";
}

function compareOne(name: string, b?: ProbeStat, n?: ProbeStat): Row {
  if (!b || !n)
    return {
      name,
      base: pq(b),
      now: pq(n),
      dPct: null,
      dSql: null,
      flag: b ? "gone" : "new",
      spread: (b ?? n)?.spread ?? 0,
    };
  const dPct = b.p50 > 0 ? r1(((n.p50 - b.p50) / b.p50) * 100) : 0;
  let sqlPct = 0;
  if (b.sql > 0) sqlPct = ((n.sql - b.sql) / b.sql) * 100;
  else if (n.sql > 0) sqlPct = 100;
  const spread = Math.max(b.spread, n.spread);
  return {
    name,
    base: pq(b),
    now: pq(n),
    dPct,
    dSql: r1(n.sql - b.sql),
    flag: flagOf(dPct, sqlPct, spread),
    spread,
  };
}

const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));

const signed = (x: number | null) => (x === null ? "-" : `${x > 0 ? "+" : ""}${x}`);
const pair = (p: { p50: number; p95: number } | null) => (p ? `${p.p50}/${p.p95}` : "-");

function renderRow(r: Row, w: number): string {
  const flag = r.flag === "ok" ? "" : r.flag;
  const extra = r.flag === "noise" ? ` (spread ${r.spread}%)` : "";
  return `${pad(r.name, w)}  ${pad(pair(r.base), 14)} ${pad(pair(r.now), 14)} ${pad(signed(r.dPct), 6)} ${pad(signed(r.dSql), 5)} ${flag}${extra}`;
}

/** Bảng ≤ 15 dòng: tiêu đề + đầu cột + tối đa 11 probe (|Δ| lớn nhất trước) + dòng tổng/“+N probe nữa”. */
export function renderTable(scn: string, base: Baseline, now: Baseline, c: Cmp): string {
  if (c.error) return `${scn}: ${c.error}`;
  const MAX = 11;
  const rows = [...c.rows].sort((a, b) => Math.abs(b.dPct ?? 0) - Math.abs(a.dPct ?? 0));
  const shown = rows.slice(0, MAX);
  const w = Math.max(12, ...shown.map((r) => r.name.length));
  const out = [
    `${scn}  base ${base.commit} (${base.date.slice(0, 10)}) vs now ${now.commit}  runs ${base.runs}/${now.runs} size ${now.size}`,
    `${pad("probe", w)}  base p50/p95   now p50/p95    Δ%    sqlΔ  flag`,
  ];
  for (const r of shown) out.push(renderRow(r, w));
  const reg = rows.filter((r) => r.flag === "REGRESSION").length;
  const win = rows.filter((r) => r.flag === "win").length;
  out.push(
    `${rows.length > MAX ? `+${rows.length - MAX} probe nữa; ` : ""}${reg} REGRESSION (> ${REGRESS_PCT}%), ${win} win (> ${WIN_PCT}%)`,
  );
  return out.join("\n");
}

/** Tên kịch bản → cách chạy trên evotest. */
export type ScnDef = { step: "perf" | "py"; filter: string };
export const SCENARIOS: Record<string, ScnDef> = {
  "timer.fire": { step: "perf", filter: "tests/perf-probe/timer-fire.perf.int.test.ts" },
  remind: { step: "perf", filter: "tests/perf-probe/remind-expire.perf.int.test.ts" },
  expire: { step: "perf", filter: "tests/perf-probe/remind-expire.perf.int.test.ts" },
  "chat.first-delta": {
    step: "perf",
    filter: "tests/perf-probe/chat-first-delta.perf.int.test.ts",
  },
  "contracts.read": { step: "perf", filter: "tests/perf-probe/contracts-read.perf.int.test.ts" },
  "claim.n": { step: "py", filter: "tests/perf_probe/claim_probe_int_test.py -s" },
};

/** Nhóm kịch bản theo (step, filter) — mỗi nhóm là MỘT lượt evotest (remind+expire dùng chung file). */
export function planRuns(
  names: readonly string[],
): { step: "perf" | "py"; filter: string; scns: string[] }[] {
  const defs = names.map((n) => ({ n, d: scnDef(n) }));
  const out: { step: "perf" | "py"; filter: string; scns: string[] }[] = [];
  // Mọi kịch bản `perf` gộp thành một lượt (filter nối bằng khoảng trắng, file trùng một lần): tiết kiệm dựng/khoá máy.
  const perf = defs.filter((x) => x.d.step === "perf");
  if (perf.length)
    out.push({
      step: "perf",
      filter: [...new Set(perf.map((x) => x.d.filter))].join(" "),
      scns: perf.map((x) => x.n),
    });
  for (const x of defs.filter((y) => y.d.step === "py"))
    out.push({ step: "py", filter: x.d.filter, scns: [x.n] });
  return out;
}

function scnDef(n: string): ScnDef {
  const d = SCENARIOS[n];
  if (!d) throw new Error(`kịch bản lạ: ${n} (có: ${Object.keys(SCENARIOS).join(", ")})`);
  return d;
}
