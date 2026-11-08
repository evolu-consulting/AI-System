// tool-evotest-fast: tóm tắt MỘT bản gọn (≤ ~15 dòng) cho lượt evotest — hàm thuần. Đầu vào: console.log của máy chủ (một hoặc nhiều ngăn),
// đầu ra: bước · thời gian · pass/fail · CHỈ đỏ MỚI (file › ca) · đường dẫn log. Log đầy đủ vẫn nằm trên đĩa. I/O: evotest-summary.ts.

export interface ParsedLog {
  pass: number;
  fail: number;
  serverS: number;
  jobs: { ok: boolean; name: string; pass: number; s: number }[];
  newReds: string[];
  knownCount: number;
  setupError: string | null;
}

export interface SummaryInput {
  step: string;
  commit: string;
  exit: number;
  wallS: number;
  /** pha → giây (vd prep, push, upload, queue, server, fetch). */
  phases?: Record<string, number>;
  logPath: string;
  logs: string[];
}

const PAR = /^test:(?:int|e2e):par: (\d+) pass, (\d+) fail, [\d.]+ s/;
const BUN_PASS = /^\s*(\d+) pass\s*$/;
const BUN_FAIL = /^\s*(\d+) fail\s*$/;
const PYTEST = /=+ (?:(\d+) failed, )?(\d+) passed/;
const JOB = /^\s+(✓|✗) (\S+): (\d+) pass.*?, ([\d.]+) s\s*$/;
const SERVER = /^\[evotest\] (?:unit|int|e2e|py|perf): exit \d+, (\d+) s/;
const NEW_RED = /^\s+NEW (.*\S)\s*$/;
const KNOWN = /^\s+known \[/;
const SETUP_ERR =
  /^(bun install lỗi|setup lỗi|uv sync lỗi|build lỗi|giải nén mã nguồn lỗi|giải kit lỗi|đĩa còn .*)/;

type Acc = ParsedLog & { parSeen: boolean; bunPass: number; bunFail: number };
type Handler = [RegExp, (m: RegExpExecArray, a: Acc) => void];

// Mỗi dòng log khớp tối đa MỘT mẫu đầu tiên (thứ tự quan trọng).
const HANDLERS: Handler[] = [
  [
    PAR,
    (m, a) => {
      a.parSeen = true;
      a.pass += Number(m[1]);
      a.fail += Number(m[2]);
    },
  ],
  [
    BUN_PASS,
    (m, a) => {
      a.bunPass += Number(m[1]);
    },
  ],
  [
    BUN_FAIL,
    (m, a) => {
      a.bunFail += Number(m[1]);
    },
  ],
  [
    PYTEST,
    (m, a) => {
      a.bunFail += Number(m[1] ?? 0);
      a.bunPass += Number(m[2]);
    },
  ],
  [
    JOB,
    (m, a) => {
      a.jobs.push({ ok: m[1] === "✓", name: m[2] ?? "", pass: Number(m[3]), s: Number(m[4]) });
    },
  ],
  [
    SERVER,
    (m, a) => {
      a.serverS += Number(m[1]);
    },
  ],
  [
    NEW_RED,
    (m, a) => {
      a.newReds.push(m[1] ?? "");
    },
  ],
  [
    KNOWN,
    (_m, a) => {
      a.knownCount += 1;
    },
  ],
  [
    SETUP_ERR,
    (m, a) => {
      if (!a.setupError) a.setupError = m[1] ?? null;
    },
  ],
];
export function parseLog(text: string): ParsedLog {
  const a: Acc = {
    pass: 0,
    fail: 0,
    serverS: 0,
    jobs: [],
    newReds: [],
    knownCount: 0,
    setupError: null,
    parSeen: false,
    bunPass: 0,
    bunFail: 0,
  };
  for (const line of text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n")) {
    for (const [re, fn] of HANDLERS) {
      const m = re.exec(line);
      if (m) {
        fn(m, a);
        break;
      }
    }
  }
  if (!a.parSeen) {
    a.pass = a.bunPass;
    a.fail = a.bunFail;
  }
  const { parSeen: _p, bunPass: _bp, bunFail: _bf, ...r } = a;
  return r;
}
const MAX_RED = 8;
const MAX_JOBS = 5;

export function formatSummary(inp: SummaryInput): string[] {
  const logs = inp.logs.map(parseLog);
  const sum = <K extends "pass" | "fail" | "serverS" | "knownCount">(k: K) =>
    logs.reduce((a, l) => a + l[k], 0);
  const reds = [...new Set(logs.flatMap((l) => l.newReds))];
  const jobs = logs.flatMap((l) => l.jobs);
  const err = logs.find((l) => l.setupError)?.setupError ?? null;
  const ok = inp.exit === 0;
  const out: string[] = [];
  out.push(
    `evotest ${ok ? "XANH" : "ĐỎ"} · ${inp.step} · ${inp.commit} · exit ${inp.exit} · tổng ${inp.wallS} s (máy chủ chạy test ${sum("serverS")} s)`,
  );
  const ph = Object.entries(inp.phases ?? {}).map(([k, v]) => `${k} ${v}s`);
  if (ph.length) out.push(`  pha: ${ph.join(" · ")}`);
  out.push(
    `  test: ${sum("pass")} pass, ${sum("fail")} fail${sum("knownCount") ? ` (đỏ cũ known-red: ${sum("knownCount")}, bỏ qua)` : ""}`,
  );
  if (err) out.push(`  LỖI hạ tầng: ${err}`);
  if (jobs.length) {
    const bad = jobs.filter((j) => !j.ok);
    const shown = [...bad, ...jobs.filter((j) => j.ok).sort((a, b) => b.s - a.s)].slice(
      0,
      MAX_JOBS,
    );
    out.push(
      `  việc e2e: ${jobs.length - bad.length}/${jobs.length} xanh; ${shown.map((j) => `${j.ok ? "✓" : "✗"}${j.name} ${j.s}s`).join(", ")}${jobs.length > MAX_JOBS ? ", …" : ""}`,
    );
  }
  if (reds.length) {
    out.push(`  đỏ MỚI (${reds.length}):`);
    for (const r of reds.slice(0, MAX_RED)) out.push(`    NEW ${r}`);
    if (reds.length > MAX_RED) out.push(`    … +${reds.length - MAX_RED} ca nữa (xem log)`);
  } else if (!ok) out.push("  đỏ MỚI: không rút được tên ca — xem 25 dòng cuối log");
  out.push(`  log đầy đủ: ${inp.logPath}`);
  return out;
}
