// HUB-FR-119 · P-c1 FC1/FC3 · parser diff hợp nhất (git) thuần, không thư viện. Bản chép: chat-web `shared/lib/diff-parse.ts` (TECH-DEBT).

export const DIFF_LINES_MAX = 2000;

export type DiffLineKind = "add" | "del" | "ctx" | "note";
export type DiffLine = { kind: DiffLineKind; text: string };
export type DiffHunk = { header: string; lines: DiffLine[] };
export type DiffFile = {
  path: string;
  oldPath: string | null;
  status: "modified" | "added" | "deleted" | "renamed";
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
};
export type ParsedDiff = {
  files: DiffFile[];
  /** Tổng số dòng của text. */
  totalLines: number;
  /** Số dòng hunk đã giữ lại (≤ `max`). */
  shownLines: number;
  truncated: boolean;
  /** Số dòng hunk bị cắt. */
  rest: number;
};

const stripPrefix = (p: string): string => p.replace(/^"?[ab]\//, "").replace(/"$/, "");

function headerPaths(line: string): { oldPath: string; path: string } {
  // "diff --git a/x b/y": tách ở " b/" cuối (đường dẫn không chứa " b/" là trường hợp thường).
  const rest = line.slice("diff --git ".length);
  const i = rest.lastIndexOf(" b/");
  if (i < 0) return { oldPath: stripPrefix(rest), path: stripPrefix(rest) };
  return { oldPath: stripPrefix(rest.slice(0, i)), path: stripPrefix(rest.slice(i + 1)) };
}

type State = { out: ParsedDiff; max: number; file: DiffFile | null; hunk: DiffHunk | null };

function newFile(line: string): DiffFile {
  const { oldPath, path } = headerPaths(line);
  return {
    path,
    oldPath: oldPath === path ? null : oldPath,
    status: "modified",
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  };
}

function openHunk(st: State, file: DiffFile, header: string): void {
  st.hunk = { header, lines: [] };
  file.hunks.push(st.hunk);
}

/** Dòng ở phần đầu file (trước hunk đầu): chế độ, đổi tên, nhị phân, `@@`. */
function headerLine(st: State, file: DiffFile, line: string): void {
  if (line.startsWith("new file mode")) file.status = "added";
  else if (line.startsWith("deleted file mode")) file.status = "deleted";
  else if (line.startsWith("rename to ")) file.status = "renamed";
  else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch"))
    file.binary = true;
  else if (line.startsWith("@@")) openHunk(st, file, line);
}

function pushLine(st: State, hunk: DiffHunk, kind: DiffLineKind, text: string): void {
  if (st.out.shownLines >= st.max) {
    st.out.truncated = true;
    st.out.rest++;
    return;
  }
  hunk.lines.push({ kind, text });
  st.out.shownLines++;
}

function hunkLine(st: State, file: DiffFile, hunk: DiffHunk, line: string): void {
  if (line.startsWith("@@")) {
    openHunk(st, file, line);
  } else if (line.startsWith("+")) {
    file.additions++;
    pushLine(st, hunk, "add", line.slice(1));
  } else if (line.startsWith("-")) {
    file.deletions++;
    pushLine(st, hunk, "del", line.slice(1));
  } else if (line.startsWith("\\")) {
    pushLine(st, hunk, "note", line.slice(2));
  } else {
    pushLine(st, hunk, "ctx", line.startsWith(" ") ? line.slice(1) : line);
  }
}

/** Phân tích diff; chỉ giữ nội dung dòng hunk cho `max` dòng đầu (đếm mọi file), còn lại chỉ đếm +/−. */
export function parseDiff(text: string, max: number = DIFF_LINES_MAX): ParsedDiff {
  const out: ParsedDiff = { files: [], totalLines: 0, shownLines: 0, truncated: false, rest: 0 };
  if (text === "") return out;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  out.totalLines = lines.length;
  const st: State = { out, max, file: null, hunk: null };
  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("diff --git ")) {
      st.file = newFile(line);
      st.hunk = null;
      out.files.push(st.file);
    } else if (st.file && st.hunk) hunkLine(st, st.file, st.hunk, line);
    else if (st.file) headerLine(st, st.file, line);
  }
  return out;
}

/** Số dòng cuối của log (bỏ dòng trống cuối). */
export function tailLines(text: string, n = 30): string {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-n).join("\n");
}
