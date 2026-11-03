// tool-hook · luật thuần của hook PreToolUse chặn SUBAGENT ghi vào checkout chính ngoài worktree của lát.
// Nhận diện subagent: trường `agent_id` trong input hook (docs Claude Code: "agent_id — định danh subagent mà hook chạy trong";
// phiên chính không có). `agent_type` có cả khi phiên chạy `--agent` nên KHÔNG dùng để nhận diện. Không I/O ở đây.

export type HookInput = {
  agent_id?: unknown;
  agent_type?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: Record<string, unknown> | null;
};

export type GuardOptions = {
  /** Gốc checkout chính, vd `F:/workspace/evolu-platform`. */
  mainRoot: string;
  /** Thư mục worktree nằm TRONG mainRoot (mặc định `<mainRoot>/.claude/worktrees`). Worktree ngoài mainRoot (evolu-wt) tự được phép. */
  worktreeRoots?: string[];
  /** agent_type được phép ghi checkout chính (vd slice:merge agent do điều phối chủ động giao). */
  allowAgentTypes?: string[];
};

export type Decision = { deny: false } | { deny: true; reason: string; path: string };

const MASK = "\u0001";
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "MultiEdit"]);
const SHELL_TOOLS = new Set(["PowerShell", "Bash"]);

/** `\`→`/`, hạ chữ thường, `/f/x`→`f:/x`, bỏ `/` cuối. */
export function normPath(p: string): string {
  let s = p.replace(/\\/g, "/").toLowerCase();
  s = s.replace(/^\/mnt\/([a-z])\//, "$1:/").replace(/^\/([a-z])\//, "$1:/");
  return s.length > 3 ? s.replace(/\/+$/, "") : s;
}

/** Nối + gọn `.`/`..` (không đụng đĩa). `base` đã chuẩn hoá; trả về đường tuyệt đối đã chuẩn hoá. */
export function resolvePath(p: string, cwd: string): string {
  const n = normPath(p);
  const full = /^[a-z]:\//.test(n) ? n : `${normPath(cwd)}/${n}`;
  const m = /^([a-z]:)\/(.*)$/.exec(full);
  if (!m) return full;
  const out: string[] = [];
  for (const seg of (m[2] ?? "").split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "." && seg !== "") out.push(seg);
  }
  return `${m[1]}/${out.join("/")}`;
}

const within = (p: string, root: string) => p === root || p.startsWith(`${root}/`);

/** Đường tuyệt đối đã chuẩn hoá nằm trong checkout chính và KHÔNG thuộc worktree nào. */
export function isForbiddenMainPath(abs: string, o: GuardOptions): boolean {
  const main = normPath(o.mainRoot);
  if (!within(abs, main)) return false;
  const wts = (o.worktreeRoots ?? [`${o.mainRoot}/.claude/worktrees`]).map(normPath);
  return !wts.some((w) => within(abs, w));
}

// ---- Tách đích ghi từ lệnh shell (best-effort, ưu tiên ít dương tính giả) ----

/** Thay nội dung chuỗi trích dẫn + thân heredoc bằng MASK (cùng độ dài) để regex không bắt chữ trong văn bản. */
export function maskQuoted(cmd: string): string {
  const out = cmd.split("");
  let q: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd.charAt(i);
    if (!q) {
      if (c === '"' || c === "'") q = c;
    } else if (isEscape(cmd, i, q)) {
      out[i] = MASK;
      if (i + 1 < cmd.length) out[++i] = MASK;
    } else if (c === q) q = null;
    else out[i] = MASK;
  }
  return maskHeredocs(out.join(""), cmd);
}

/** Trong chuỗi trích dẫn: backtick (PowerShell) hoặc `\"` là ký tự thoát. */
const isEscape = (cmd: string, i: number, q: string) =>
  cmd[i] === "`" || (q === '"' && cmd[i] === "\\" && cmd[i + 1] === '"');

function maskHeredocs(masked: string, orig: string): string {
  const out = masked.split("");
  const re = /<<-?\s*(["']?)(\w+)\1[^\n]*\n/g;
  for (let m = re.exec(orig); m; m = re.exec(orig)) {
    const start = m.index + m[0].length;
    const end = orig.indexOf(`\n${m[2]}`, start - 1);
    const stop = end < 0 ? orig.length : end;
    for (let i = start; i < stop; i++) if (out[i] !== "\n") out[i] = MASK;
  }
  return out.join("");
}

/** Đọc một token từ `orig` tại `i` (bỏ khoảng trắng đầu); có thể trích dẫn. `stop` = ký tự kết thúc token không trích dẫn. */
function readToken(orig: string, i: number, stop: RegExp): { tok: string; end: number } | null {
  let j = i;
  while (j < orig.length && /[ \t]/.test(orig.charAt(j))) j++;
  if (j >= orig.length) return null;
  const q = orig[j];
  if (q === '"' || q === "'") {
    const close = orig.indexOf(q, j + 1);
    if (close < 0) return null;
    return { tok: orig.slice(j + 1, close), end: close + 1 };
  }
  let k = j;
  while (k < orig.length && !stop.test(orig.charAt(k))) k++;
  return k > j ? { tok: orig.slice(j, k), end: k } : null;
}

const REDIR_STOP = /[\s;|&)<>]/;

function redirectTargets(orig: string, masked: string): string[] {
  const res: string[] = [];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== ">") continue;
    const prev = masked[i - 1] ?? "";
    if (prev === "=" || prev === "-" || prev === "<") continue; // `=>`, `->`, `<>`
    let j = i + 1;
    if (masked[j] === ">") j++;
    if (masked[j] === "&" || masked[j] === "(") continue; // `2>&1`, `>(…)`
    const t = readToken(orig, j, REDIR_STOP);
    if (t) {
      res.push(t.tok);
      i = t.end - 1;
    }
  }
  return res;
}

const CMDLET_RE = /(?<![\w-])(Out-File|Set-Content|Add-Content|Tee-Object|tee)(?![\w-])/gi;
const VALUE_PARAMS =
  /^-(encoding|value|width|stream|filter|include|exclude|inputobject|variable)$/i;
const PATH_PARAMS = /^-(filepath|path|literalpath|pa|lp)$/i;

function cmdletTargets(orig: string, masked: string): string[] {
  const res: string[] = [];
  CMDLET_RE.lastIndex = 0;
  for (let m = CMDLET_RE.exec(masked); m; m = CMDLET_RE.exec(masked)) {
    let i = m.index + m[0].length;
    const seg = /[;|&\n\r)]/.exec(masked.slice(i));
    const end = seg ? i + seg.index : masked.length;
    const t = firstPathArg(orig.slice(i, end));
    if (t) res.push(t);
    i = end;
  }
  return res;
}

function firstPathArg(region: string): string | null {
  let i = 0;
  let wantPath = false;
  let skipNext = false;
  for (let t = readToken(region, i, /\s/); t; t = readToken(region, i, /\s/)) {
    i = t.end;
    if (skipNext) skipNext = false;
    else if (PATH_PARAMS.test(t.tok)) wantPath = true;
    else if (VALUE_PARAMS.test(t.tok)) skipNext = true;
    else if (!t.tok.startsWith("-") || wantPath) return t.tok;
  }
  return null;
}

const IOFILE_RE = /\[(?:System\.)?IO\.File\]::(?:Write|AppendAll|Create|Open)\w*\(\s*/gi;

function ioFileTargets(orig: string): string[] {
  const res: string[] = [];
  IOFILE_RE.lastIndex = 0;
  for (let m = IOFILE_RE.exec(orig); m; m = IOFILE_RE.exec(orig)) {
    const t = readToken(orig, m.index + m[0].length, /[,)]/);
    if (t) res.push(t.tok);
  }
  return res;
}

/** Mọi đích ghi nhận diện được trong một lệnh shell (chưa lọc). */
export function extractWriteTargets(cmd: string): string[] {
  const masked = maskQuoted(cmd);
  return [...redirectTargets(cmd, masked), ...cmdletTargets(cmd, masked), ...ioFileTargets(cmd)];
}

const NULL_SINKS = /^(\$null|\/dev\/null|nul|nul:|\/dev\/std(out|err))$/i;
const UNRESOLVABLE = /[$%~`*?]|^\s*$|^=/; // biến, glob, ~, `>=` → không biết đường thật → cho qua

function targetViolation(tok: string, cwd: string, o: GuardOptions): string | null {
  if (NULL_SINKS.test(tok) || UNRESOLVABLE.test(tok)) return null;
  const abs = resolvePath(tok, cwd);
  return isForbiddenMainPath(abs, o) ? abs : null;
}

// ---- Quyết định ----

const reasonFor = (abs: string, o: GuardOptions) =>
  `Chặn: subagent ghi ngoài worktree của lát (${abs} nằm trong checkout chính ${o.mainRoot}). ` +
  "Ghi ngoài worktree của lát — dùng đường dẫn tuyệt đối F:\\workspace\\evolu-wt\\<lát>\\… " +
  "(Write/Edit, không dùng đường dẫn tương đối hay chuyển hướng shell trỏ vào checkout chính).";

export function isSubagent(input: HookInput): boolean {
  return typeof input.agent_id === "string" && input.agent_id.length > 0;
}

function writeToolPath(ti: Record<string, unknown>): string | null {
  const p = ti.file_path ?? ti.notebook_path ?? ti.path;
  return typeof p === "string" && p.length > 0 ? p : null;
}

export function decide(input: HookInput, o: GuardOptions): Decision {
  if (!isSubagent(input)) return { deny: false };
  if (typeof input.agent_type === "string" && o.allowAgentTypes?.includes(input.agent_type))
    return { deny: false };
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const ti = input.tool_input ?? {};
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : o.mainRoot;
  const targets: string[] = [];
  if (WRITE_TOOLS.has(tool)) {
    const p = writeToolPath(ti);
    if (p) targets.push(p);
  } else if (SHELL_TOOLS.has(tool) && typeof ti.command === "string") {
    targets.push(...extractWriteTargets(ti.command));
  }
  for (const t of targets) {
    const abs = targetViolation(t, cwd, o);
    if (abs) return { deny: true, reason: reasonFor(abs, o), path: abs };
  }
  return { deny: false };
}
