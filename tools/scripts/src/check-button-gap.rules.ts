// Luật thuần cho `check:button-gap` (CR-163): container flex có ≥ 2 nút con trực tiếp phải có gap-*/space-x-*.
// Bỏ qua: flex-col (không có biến thể hàng), nút tự có margin ngang, dòng/khối có chú thích `button-gap-ok`.

export interface GapViolation {
  line: number;
  tag: string;
}

interface Node {
  name: string; // "" = fragment
  attrs: string;
  line: number;
  children: Node[];
}

const BUTTONS = new Set(["Button", "Btn", "button"]);
const PREV_OK = /[(){}[\],=?:&|>;]$|(^|\s)return$/;

function lineOf(src: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

/** Đọc phần thuộc tính tới `>` ngoài ngoặc/chuỗi; trả [attrs, vị trí sau `>`, tự đóng]. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: bộ đọc JSX một lượt, tách ra khó đọc hơn
function readAttrs(src: string, from: number): [string, number, boolean] {
  let depth = 0;
  let quote = "";
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && src[i - 1] !== "=") {
      const self = src[i - 1] === "/";
      return [src.slice(from, self ? i - 1 : i), i + 1, self];
    }
  }
  return [src.slice(from), src.length, true];
}

/** Cột dọc (flex-col không có biến thể hàng) thì nút xếp chồng, không cần gap ngang. */
function isColumn(attrs: string): boolean {
  return /flex-col|grid-cols-1|space-y-/.test(attrs) && !/flex-row/.test(attrs);
}

export interface Spaced {
  /** Class có `gap` (chỉ tính khi đứng ở container). */
  gap: Set<string>;
  /** Class có margin ngang (tính ở container hoặc ở nút). */
  margin: Set<string>;
}

/** Class CSS thường (không phải Tailwind) được khai báo kèm gap / margin ngang trong file css. */
export function spacedClasses(css: string): Spaced {
  const out: Spaced = { gap: new Set(), margin: new Set() };
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    const body = m[2] ?? "";
    const g = /(^|[;\s])(gap|column-gap)\s*:\s*(?!0\s*(;|$))/.test(body);
    const mg = /(^|[;\s])margin(-left|-right|-inline(-start|-end)?)?\s*:\s*(?!0\s*(;|$))/.test(
      body,
    );
    for (const c of (m[1] ?? "").matchAll(/\.([\w-]+)/g)) {
      if (!c[1]) continue;
      if (g) out.gap.add(c[1]);
      if (mg) out.margin.add(c[1]);
    }
  }
  return out;
}

function classTokens(attrs: string): string[] {
  const cls = /className=/.exec(attrs);
  return cls ? [...attrs.slice(cls.index).matchAll(/[\w:-]+/g)].map((t) => t[0]) : [];
}
const hasGap = (a: string) => /(^|[\s"'`])(sm:|md:|lg:)?(gap(-[xy])?-|space-x-)/.test(a);
const hasMargin = (a: string) => /(^|[\s"'`:])-?m[lrx]-/.test(a);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: bộ đọc JSX một lượt, tách ra khó đọc hơn
export function parseJsx(src: string): Node {
  const root: Node = { name: "#root", attrs: "", line: 0, children: [] };
  const stack: Node[] = [root];
  const re = /<(\/?)([A-Za-z][\w.]*)?/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m) {
    const before = src.slice(Math.max(0, m.index - 12), m.index).trimEnd();
    const isTag = m[2] !== undefined || src[m.index + 1] === ">" || src.startsWith("</>", m.index);
    const frag = m[2] === undefined;
    if (!isTag || (!m[1] && !PREV_OK.test(before) && before !== "" && !frag)) {
      m = re.exec(src);
      continue;
    }
    if (m[1]) {
      const end = src.indexOf(">", m.index);
      const top = stack[stack.length - 1];
      if (stack.length > 1 && top) {
        stack.pop();
        if (top.name === "") stack[stack.length - 1]?.children.push(...top.children);
      }
      re.lastIndex = end + 1;
    } else if (frag) {
      stack.push({ name: "", attrs: "", line: lineOf(src, m.index), children: [] });
      re.lastIndex = m.index + 2;
    } else {
      const [attrs, next, self] = readAttrs(src, m.index + m[0].length);
      const node: Node = { name: m[2] ?? "", attrs, line: lineOf(src, m.index), children: [] };
      stack[stack.length - 1]?.children.push(node);
      if (!self) stack.push(node);
      re.lastIndex = next;
    }
    m = re.exec(src);
  }
  return root;
}

/** Các nút nằm liền nhau (anh em kề nhau); nút bị chen phần tử khác thì không tính. Nút `block` (danh sách dọc) bỏ qua. */
function adjacentButtons(children: Node[]): Node[] {
  const out: Node[] = [];
  for (let i = 1; i < children.length; i++) {
    const a = children[i - 1];
    const b = children[i];
    if (!a || !b || !BUTTONS.has(a.name) || !BUTTONS.has(b.name)) continue;
    if (
      /(^|[\s"'`])(block|flex|w-full)(?=[\s"'`])/.test(a.attrs) &&
      /(^|[\s"'`])w-full(?=[\s"'`])/.test(b.attrs)
    )
      continue;
    if (!out.includes(a)) out.push(a);
    out.push(b);
  }
  return out;
}

export function findGapViolations(
  src: string,
  spaced: Spaced = { gap: new Set(), margin: new Set() },
): GapViolation[] {
  const lines = src.split("\n");
  const out: GapViolation[] = [];
  const walk = (n: Node) => {
    const btns = adjacentButtons(n.children);
    if (
      /^[a-z]/.test(n.name) &&
      btns.length >= 2 &&
      !isColumn(n.attrs) &&
      !hasGap(n.attrs) &&
      !classTokens(n.attrs).some((t) => spaced.gap.has(t) || spaced.margin.has(t)) &&
      !btns.some(
        (b) => hasMargin(b.attrs) || classTokens(b.attrs).some((t) => spaced.margin.has(t)),
      ) &&
      !/button-gap-ok/.test(lines[n.line - 1] ?? "") &&
      !/button-gap-ok/.test(lines[n.line - 2] ?? "")
    )
      out.push({ line: n.line, tag: n.name });
    for (const c of n.children) walk(c);
  };
  walk(parseJsx(src));
  return out;
}
