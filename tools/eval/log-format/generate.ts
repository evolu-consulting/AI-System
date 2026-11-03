// CR-114 hub-eval · sinh log mẫu ở 4 khuôn (verbose / short_words / num_codes / kv_line) + đáp án đúng, để đo token
// và mức hiểu của model. Chạy được mọi OS (thay gen.py/gen2.py). Hạt cố định ⇒ cùng dữ liệu mỗi lần.
// simple = 40 sự kiện, 1 run, câu hỏi 1 bước; complex = 300 sự kiện, 12 run đan xen, câu hỏi nhiều bước.

export const FORMATS = ["verbose", "short_words", "num_codes", "kv_line"] as const;
export type FormatName = (typeof FORMATS)[number];

type Row = {
  time: number;
  event: string;
  run_id: string;
  agent: string;
  tool: string | null;
  duration_ms: number;
  tokens_in: number;
  tokens_out: number;
  artifact?: string;
  error: string | null;
};

export type Dataset = {
  complex: boolean;
  events: number;
  formats: Record<FormatName, string>;
  /** Đáp án đúng, khoá = khoá của câu hỏi. */
  answer: Record<string, unknown>;
  /** Khoá vô hướng so bằng `String`; khoá mảng so sau khi sắp xếp. */
  scalarKeys: string[];
  arrayKey: string;
  question: string;
};

/** mulberry32: PRNG có hạt (thay `random.seed` của Python — số sinh ra khác bản .py, đủ cho mục đích đo). */
export function rng(seed: number): {
  int: (lo: number, hi: number) => number;
  pick: <T>(a: readonly T[]) => T;
  float: () => number;
} {
  let s = seed >>> 0;
  const float = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    float,
    int: (lo, hi) => lo + Math.floor(float() * (hi - lo + 1)),
    pick: (a) => a[Math.floor(float() * a.length)] as never,
  };
}

const sortedJoin = (a: readonly unknown[]): string => [...a].map(String).sort().join(",");
const shortId = (r: Row): string => r.run_id.slice(-6);
const jsonOmitNull = (r: Row): string =>
  JSON.stringify(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)));

function render(
  rows: Row[],
  events: string[],
  agents: string[],
  tools: string[],
  withArtifact: boolean,
): Record<FormatName, string> {
  const code = Object.fromEntries(events.map((e, i) => [e, `E${i}`]));
  const legend = `Legend: ${JSON.stringify({
    e: Object.fromEntries(events.map((e, i) => [`E${i}`, e])),
    ag: Object.fromEntries(agents.map((a, i) => [i, a])),
    tool: Object.fromEntries(tools.map((t, i) => [i, t])),
  })}\n`;
  const base = (r: Row, ev: string, ag: string | number) => ({
    t: r.time,
    e: ev,
    run: shortId(r),
    ag,
    ms: r.duration_ms,
    tk: [r.tokens_in, r.tokens_out],
    ...(withArtifact && r.artifact ? { x: r.artifact.slice(0, 6) } : {}),
  });
  const compact = (o: object): string => JSON.stringify(o);
  const lines = (fn: (r: Row) => string, pre = ""): string => `${pre}${rows.map(fn).join("\n")}\n`;
  return {
    verbose: lines(jsonOmitNull),
    short_words: lines((r) =>
      compact({
        ...base(r, r.event, r.agent),
        ...(r.tool ? { tool: r.tool } : {}),
        ...(r.error ? { err: r.error } : {}),
      }),
    ),
    num_codes: lines(
      (r) =>
        compact({
          ...base(r, code[r.event] ?? "?", agents.indexOf(r.agent)),
          ...(r.tool ? { tool: tools.indexOf(r.tool) } : {}),
          ...(r.error ? { err: r.error } : {}),
        }),
      legend,
    ),
    kv_line: lines((r) => {
      const p = [
        `t=${r.time}`,
        `e=${r.event}`,
        `run=${shortId(r)}`,
        `ag=${r.agent}`,
        `ms=${r.duration_ms}`,
        `tk=${r.tokens_in}/${r.tokens_out}`,
      ];
      if (withArtifact && r.artifact) p.push(`x=${r.artifact.slice(0, 6)}`);
      if (r.tool) p.push(`tool=${r.tool}`);
      if (r.error) p.push(`err="${r.error}"`);
      return p.join(" ");
    }),
  };
}

function simple(): Dataset {
  const R = rng(7);
  const EV = [
    "run.start",
    "step.start",
    "tool.call",
    "tool.done",
    "step.done",
    "tool.error",
    "run.done",
  ];
  const AG = ["contracts", "orchestrator", "dify-invoice", "rag"];
  const TOOLS = ["contract.search", "invoice.create", "doc.fetch"];
  const runFull = "0193a8f2-6c1e-7b44-9d1a-3f9c21e8b0aa";
  const rows: Row[] = [];
  let t = 1730612345;
  for (let i = 0; i < 40; i++) {
    const event = EV[Math.min(i % 7, 6)] as string;
    t += R.int(1, 900);
    rows.push({
      time: t,
      event,
      run_id: runFull,
      agent: AG[i % 4] as string,
      tool: event.startsWith("tool") ? (TOOLS[i % 3] as string) : null,
      duration_ms: R.int(20, 4000),
      tokens_in: R.int(200, 3000),
      tokens_out: R.int(5, 400),
      artifact: `3f9c21e8b0aa77d1c0${i % 10}`,
      error: event === "tool.error" ? "timeout after 30s" : null,
    });
  }
  const err = rows.filter((r) => r.error);
  const slow = rows.reduce((a, b) => (b.duration_ms > a.duration_ms ? b : a));
  return {
    complex: false,
    events: rows.length,
    formats: render(rows, EV, AG, TOOLS, true),
    answer: {
      n_errors: err.length,
      error_tools: [...new Set(err.map((r) => r.tool))].sort(),
      slowest_event: slow.event,
      slowest_agent: slow.agent,
      slowest_ms: slow.duration_ms,
      total_tokens_out: rows.reduce((s, r) => s + r.tokens_out, 0),
    },
    scalarKeys: ["n_errors", "slowest_event", "slowest_agent", "slowest_ms", "total_tokens_out"],
    arrayKey: "error_tools",
    question:
      'Read the log below. Return ONLY one JSON: {"n_errors":number of error events,"error_tools":[full names of tools that errored],"slowest_event":full event name of the slowest event,"slowest_agent":full agent name of that event,"slowest_ms":number,"total_tokens_out":sum of output tokens}. No explanation.',
  };
}

const AG_C = ["contracts", "orchestrator", "dify-invoice", "rag"];
const TOOLS_C = ["contract.search", "invoice.create", "doc.fetch", "user.lookup"];

function complexRows(R: ReturnType<typeof rng>): Row[] {
  const AG = AG_C;
  const TOOLS = TOOLS_C;
  const hex12 = (): string =>
    (R.int(0, 0xffffff) * 0x1000000 + R.int(0, 0xffffff)).toString(16).padStart(12, "0");
  const runs = Array.from({ length: 12 }, () => `0193a8f2-6c1e-7b44-9d1a-${hex12()}`);
  const rows: Row[] = [];
  let t = 1730612345;
  for (let i = 0; i < 300; i++) {
    const run = R.pick(runs);
    const agent = R.pick(AG);
    t += R.int(1, 60);
    if (R.float() < 0.45) {
      const tool = R.pick(TOOLS);
      const ok = R.float() > 0.18;
      rows.push({
        time: t,
        event: ok ? "tool.done" : "tool.error",
        run_id: run,
        agent,
        tool,
        duration_ms: R.int(30, 5000),
        tokens_in: R.int(100, 2500),
        tokens_out: R.int(5, 300),
        error: ok ? null : R.pick(["timeout after 30s", "403 forbidden", "schema mismatch"]),
      });
    } else {
      rows.push({
        time: t,
        event: R.pick(["step.done", "llm.call"]),
        run_id: run,
        agent,
        tool: null,
        duration_ms: R.int(200, 9000),
        tokens_in: R.int(500, 6000),
        tokens_out: R.int(20, 900),
        error: null,
      });
    }
  }
  return rows;
}

function complexAnswer(rows: Row[]): Record<string, unknown> {
  const AG = AG_C;
  const TOOLS = TOOLS_C;
  const calls: Record<string, number> = {};
  const errs: Record<string, number> = {};
  for (const r of rows) {
    if (!r.tool) continue;
    calls[r.tool] = (calls[r.tool] ?? 0) + 1;
    if (r.error) errs[r.tool] = (errs[r.tool] ?? 0) + 1;
  }
  const rate = (k: string): number => (errs[k] ?? 0) / (calls[k] ?? 1);
  const worst = TOOLS.reduce((a, b) => (rate(b) > rate(a) ? b : a));
  const tokByRun: Record<string, number> = {};
  for (const r of rows)
    tokByRun[shortId(r)] = (tokByRun[shortId(r)] ?? 0) + r.tokens_in + r.tokens_out;
  const top = Object.keys(tokByRun).reduce((a, b) =>
    (tokByRun[b] ?? 0) > (tokByRun[a] ?? 0) ? b : a,
  );
  const recovered = new Set<string>();
  rows.forEach((r, i) => {
    if (
      r.error === "403 forbidden" &&
      rows
        .slice(i + 1)
        .some((x) => x.run_id === r.run_id && x.tool === r.tool && x.event === "tool.done")
    )
      recovered.add(shortId(r));
  });
  const llmMs = (a: string): number =>
    rows
      .filter((r) => r.agent === a && r.event === "llm.call")
      .reduce((s, r) => s + r.duration_ms, 0);
  return {
    worst_error_rate_tool: worst,
    top_token_run: top,
    top_token_run_total: tokByRun[top],
    runs_403_then_recovered: [...recovered].sort(),
    agent_most_llm_ms: AG.reduce((a, b) => (llmMs(b) > llmMs(a) ? b : a)),
    n_schema_mismatch: rows.filter((r) => r.error === "schema mismatch").length,
  };
}

function complex(): Dataset {
  const rows = complexRows(rng(11));
  const events = [...new Set(rows.map((r) => r.event))].sort();
  return {
    complex: true,
    events: rows.length,
    formats: render(rows, events, AG_C, TOOLS_C, false),
    answer: complexAnswer(rows),
    scalarKeys: [
      "worst_error_rate_tool",
      "top_token_run",
      "top_token_run_total",
      "agent_most_llm_ms",
      "n_schema_mismatch",
    ],
    arrayKey: "runs_403_then_recovered",
    question:
      'Read the log below (one event per line; run ids are 6-char suffixes). Return ONLY one JSON: {"worst_error_rate_tool":tool name with the highest error rate (errors / calls of that tool),"top_token_run":run id with the most total tokens (in+out over all its events),"top_token_run_total":that total,"runs_403_then_recovered":[sorted run ids where a tool got "403 forbidden" and later in the SAME run the SAME tool succeeded (tool.done)],"agent_most_llm_ms":agent with the largest total duration of llm.call events,"n_schema_mismatch":count of "schema mismatch" errors}. Use full names. No explanation.',
  };
}

export const generate = (isComplex: boolean): Dataset => (isComplex ? complex() : simple());

/** Chấm một câu trả lời của model: số khoá đúng trên tổng (5 vô hướng + 1 mảng = 6). Không đọc được JSON ⇒ 0. */
export function gradeAnswer(ds: Dataset, raw: string): { correct: number; total: number } {
  const total = ds.scalarKeys.length + 1;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { correct: 0, total };
  let got: Record<string, unknown>;
  try {
    got = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return { correct: 0, total };
  }
  let correct = ds.scalarKeys.filter((k) => String(got[k]) === String(ds.answer[k])).length;
  const g = got[ds.arrayKey];
  if (Array.isArray(g) && sortedJoin(g) === sortedJoin(ds.answer[ds.arrayKey] as unknown[]))
    correct++;
  return { correct, total };
}
