// Luật thuần cho `bun run spec:find` (docs/platform/dev-flow.md §7 Bậc 1): bỏ dấu, tách từ, từ đồng nghĩa,
// cắt Markdown theo heading, BM25. Không đọc đĩa.

export type SpecSource = "current" | "delta" | "cr" | "adr" | "debt" | "history";
export type SpecStatus = "đang chạy" | "đang làm" | "CR" | "ADR" | "nợ kỹ thuật" | "lịch sử";

export interface SpecUnit {
  source: SpecSource;
  file: string;
  /** dòng 1-based của dòng đầu đơn vị (dòng i của `text` = line + i). */
  line: number;
  area: string;
  title: string;
  codes: string[];
  status: SpecStatus;
  text: string;
}

/** Nhóm đồng nghĩa: mỗi nhóm là danh sách cụm từ (có dấu cũng được) tương đương nhau. */
export type SynonymGroups = string[][];

/** Bỏ dấu tiếng Việt, đ→d, chữ thường. */
export function fold(s: string): string {
  return s
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

const STOP = new Set(
  "la va cua cho the nhung mot cac co khong duoc de trong khi voi nay thi se da dang vao ra tu den theo nhu hay hoac ma thay and or of to in is are for on a an".split(
    " ",
  ),
);

/** Tách từ đã bỏ dấu; bỏ từ dừng và token 1 ký tự chữ (giữ chữ số). */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const t of fold(s).split(/[^a-z0-9]+/)) {
    if (!t || STOP.has(t)) continue;
    if (t.length < 2 && !/\d/.test(t)) continue;
    out.push(t);
  }
  return out;
}

const CODE_RE =
  /\b(?:CR-\d+|[A-Z]{2,6}(?:-[A-Z]{1,5})?-(?:FR|BR|AC|NFR)-\d+|[A-Z]{2,6}-(?:FR|BR|AC|NFR)\d+)\b/g;

export function extractCodes(s: string): string[] {
  return [...new Set(s.match(CODE_RE) ?? [])];
}

export interface WeightedToken {
  term: string;
  weight: number;
}

/** Truy vấn → token gốc (trọng số 1) + token từ đồng nghĩa (0.6) khi cụm từ nhóm xuất hiện trong truy vấn. */
export function expandQuery(query: string, groups: SynonymGroups): WeightedToken[] {
  const base = tokenize(query);
  const padded = ` ${fold(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(" ")} `;
  const w = new Map<string, number>();
  for (const t of base) w.set(t, 1);
  for (const g of groups) {
    const phrases = g.map((p) =>
      fold(p)
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .join(" "),
    );
    const hit = phrases.some((p) => p && padded.includes(` ${p} `));
    if (!hit) continue;
    for (const p of phrases) for (const t of tokenize(p)) if (!w.has(t)) w.set(t, 0.6);
  }
  return [...w].map(([term, weight]) => ({ term, weight }));
}

export interface ChunkMeta {
  source: SpecSource;
  file: string;
  area: string;
  status: SpecStatus;
  /** dòng 1-based của dòng đầu của `text` trong file gốc. */
  lineOffset?: number;
  /** chia nhỏ khi một mục dài hơn số dòng này (mặc định 25). */
  maxLines?: number;
}

function headingText(l: string): string | null {
  const h = /^#{1,6}\s+(.*\S)\s*$/.exec(l);
  return h ? (h[1] ?? "").replace(/[`*]/g, "") : null;
}

/** Cắt Markdown theo heading (bỏ qua ``` ); mục quá dài chia tiếp ở dòng trống. */
export function chunkMarkdown(text: string, meta: ChunkMeta): SpecUnit[] {
  const lines = text.split(/\r?\n/);
  const off = (meta.lineOffset ?? 1) - 1;
  const max = meta.maxLines ?? 25;
  const units: SpecUnit[] = [];
  let title = "";
  let start = 0;
  let buf: string[] = [];
  let fence = false;

  const flush = () => {
    const body = buf.join("\n");
    if (buf.some((l) => l.trim() && !/^#+\s/.test(l))) {
      const first = (buf.find((l) => l.trim()) ?? "").replace(/^[#\s|]+/, "");
      const t = title || first.slice(0, 80);
      units.push({
        source: meta.source,
        file: meta.file,
        line: start + 1 + off,
        area: meta.area,
        title: t,
        codes: extractCodes(`${t}\n${body}`),
        status: meta.status,
        text: body,
      });
    }
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (l.trimStart().startsWith("```")) fence = !fence;
    const h = fence ? null : headingText(l);
    if (h !== null) {
      flush();
      title = h;
      start = i;
    } else if (buf.length === 0) start = i;
    buf.push(l);
    if (h === null && !fence && buf.length >= max && l.trim() === "") {
      flush();
      start = i + 1;
    }
  }
  flush();
  return units;
}

export interface Index {
  units: SpecUnit[];
  tf: Map<string, number>[];
  len: number[];
  df: Map<string, number>;
  avg: number;
}

export function buildIndex(units: SpecUnit[]): Index {
  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  const df = new Map<string, number>();
  for (const u of units) {
    const toks = [
      ...tokenize(u.title),
      ...tokenize(u.title),
      ...tokenize(u.area),
      ...tokenize(u.text),
      ...u.codes.flatMap((c) => tokenize(c)),
    ];
    const m = new Map<string, number>();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(m);
    len.push(toks.length);
  }
  const avg = len.length ? len.reduce((a, b) => a + b, 0) / len.length : 1;
  return { units, tf, len, df, avg };
}

/** Trọng số độ tin cậy theo nguồn (docs/current thắng). */
export const TRUST: Record<SpecSource, number> = {
  current: 1,
  delta: 0.95,
  cr: 0.8,
  adr: 0.8,
  debt: 0.6,
  history: 0.5,
};

export interface Hit {
  unit: SpecUnit;
  score: number;
}

export function search(idx: Index, query: string, groups: SynonymGroups, k = 8): Hit[] {
  const q = expandQuery(query, groups);
  const N = idx.units.length;
  const k1 = 1.2;
  const b = 0.75;
  const hits: Hit[] = [];
  for (let i = 0; i < N; i++) {
    const m = idx.tf[i] as Map<string, number>;
    let s = 0;
    for (const { term, weight } of q) {
      const f = m.get(term);
      if (!f) continue;
      const n = idx.df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const norm = (f * (k1 + 1)) / (f + k1 * (1 - b + (b * (idx.len[i] ?? 1)) / idx.avg));
      s += weight * idf * norm;
    }
    if (s > 0)
      hits.push({
        unit: idx.units[i] as SpecUnit,
        score: s * TRUST[(idx.units[i] as SpecUnit).source],
      });
  }
  hits.sort((a, c) => c.score - a.score);
  return hits.slice(0, k);
}

/** Dòng khớp nhất trong đơn vị → { line, excerpt ≤ 160 ký tự }. */
export function bestLine(
  u: SpecUnit,
  query: string,
  groups: SynonymGroups,
): { line: number; excerpt: string } {
  const q = new Set(expandQuery(query, groups).map((x) => x.term));
  const ls = u.text.split(/\r?\n/);
  let bi = 0;
  let bs = -1;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i] ?? "";
    if (!l.trim() || /^#+\s*$/.test(l)) continue;
    const s = new Set(tokenize(l).filter((t) => q.has(t))).size;
    if (s > bs) {
      bs = s;
      bi = i;
    }
  }
  const raw = (ls[bi] ?? "").replace(/\s+/g, " ").trim();
  return { line: u.line + bi, excerpt: raw.length > 160 ? `${raw.slice(0, 157)}...` : raw };
}

export function formatHit(h: Hit, query: string, groups: SynonymGroups): string {
  const { line, excerpt } = bestLine(h.unit, query, groups);
  return `${h.unit.file}:${line} · ${h.unit.source} · ${h.unit.status} · ${h.unit.title.slice(0, 80)} — ${excerpt}`;
}
