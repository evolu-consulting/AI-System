// CR-177 U4 · hàm đếm thuần cho `check:ui-kit` (kiểu ratchet: số đếm chỉ được giảm).
export const METRICS = ["button", "select", "input", "title", "arbitrary"] as const;
export type Metric = (typeof METRICS)[number];
export type Hit = { metric: Metric; line: number };

const BARE_INPUT_SKIP = /\btype=(?:"|'|\{")(?:hidden|file|checkbox|radio)(?:"|'|"\})/;

function lineOf(src: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

/** Cuối thẻ mở bắt đầu ở `from`: `>` đầu tiên ngoài `{…}` (bỏ qua `=>`). */
function tagEnd(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth <= 0 && src[i - 1] !== "=") return i;
  }
  return src.length;
}

/** Thuộc tính `title=` nằm trên thẻ HTML thường (chữ thường), không tính prop của component viết hoa. */
function titleHits(src: string): number[] {
  const out: number[] = [];
  const re = /\stitle=[{"']/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = src.lastIndexOf("<", m.index);
    if (open < 0 || !/[a-z]/.test(src[open + 1] ?? "")) continue;
    if (tagEnd(src, open) < m.index) continue; // title nằm ngoài thẻ (văn bản/đối tượng)
    out.push(m.index);
  }
  return out;
}

export function findHits(src: string): Hit[] {
  const hits: Hit[] = [];
  const add = (metric: Metric, idx: number) => hits.push({ metric, line: lineOf(src, idx) });
  for (const m of src.matchAll(/<button\b/g)) add("button", m.index ?? 0);
  for (const m of src.matchAll(/<select\b/g)) add("select", m.index ?? 0);
  for (const m of src.matchAll(/<input\b/g)) {
    const idx = m.index ?? 0;
    if (!BARE_INPUT_SKIP.test(src.slice(idx, tagEnd(src, idx)))) add("input", idx);
  }
  for (const idx of titleHits(src)) add("title", idx);
  const arb = /\b(?:text-\[[\d.]+(?:px|rem|em)\]|rounded(?:-[a-z]{1,2})?-\[[^\]\s]+\])/g;
  for (const m of src.matchAll(arb)) add("arbitrary", m.index ?? 0);
  return hits.sort((a, b) => a.line - b.line);
}

export type AppCounts = Record<Metric | "uiFiles", number>;
export type Baseline = Record<string, AppCounts>;

export const emptyCounts = (): AppCounts => ({
  button: 0,
  select: 0,
  input: 0,
  title: 0,
  uiFiles: 0,
  arbitrary: 0,
});

const KEYS = [...METRICS, "uiFiles"] as const;

/** Chỉ số vượt mốc (cur > base) và chỉ số thấp hơn mốc. */
export function compare(
  cur: AppCounts,
  base: AppCounts | undefined,
): { over: (keyof AppCounts)[]; under: (keyof AppCounts)[] } {
  const b = base ?? emptyCounts();
  const over: (keyof AppCounts)[] = [];
  const under: (keyof AppCounts)[] = [];
  for (const k of KEYS) {
    if (cur[k] > b[k]) over.push(k);
    else if (cur[k] < b[k]) under.push(k);
  }
  return { over, under };
}
