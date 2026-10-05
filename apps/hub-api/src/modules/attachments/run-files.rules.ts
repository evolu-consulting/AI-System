// HUB-FR-44 · WRK-FR-11 · H2c-R14, R15, R18, R24 · tập file của run, tên file trong job, khối file trong prompt
// (plan-rules §3). B4: `pickRunFiles`; B6: tên trong job, khối file trong prompt, `OUT_HINT`.
import type { AttachMime } from "@ai/contracts/chat";
import type { JobAttachment } from "@ai/contracts/hub";
import { splitExt } from "./attachment.rules";

export const RUN_FILES_MAX = 10;
export const RUN_FILES_MAX_BYTES = 104_857_600;

/** Hàng `plan-db` §2.3 (chỉ file `available`). */
export type FileRow = {
  id: string;
  messageId: string;
  messageCreatedAt: Date;
  position: number;
  safeName: string;
  mime: AttachMime;
  size: number;
  sha256: string;
};

/** File của run (`name` = `safe_name`). */
export type RunFile = { id: string; name: string; mime: AttachMime; size: number; sha256: string };

export type FileBrief = { name: string; mime: string; size: number };

export const fileBrief = (f: FileBrief): FileBrief => ({
  name: f.name,
  mime: f.mime,
  size: f.size,
});

/** Thứ tự R14: tin hiện tại trước; tin khác `messageCreatedAt` giảm, hoà → `messageId` giảm; trong tin `position` tăng. */
function runFileOrder(cur: string) {
  return (a: FileRow, b: FileRow): number => {
    const ca = a.messageId === cur ? 1 : 0;
    const cb = b.messageId === cur ? 1 : 0;
    if (ca !== cb) return cb - ca;
    const dt = b.messageCreatedAt.getTime() - a.messageCreatedAt.getTime();
    if (dt !== 0) return dt;
    if (a.messageId !== b.messageId) return a.messageId < b.messageId ? 1 : -1;
    return a.position - b.position;
  };
}

/** R14: `command` → chỉ tin hiện tại; sắp tin hiện tại trước, rồi mới → cũ; dừng ở file thứ 11 hoặc khi tổng > 100 MiB. */
export function pickRunFiles(
  rows: readonly FileRow[],
  o: { currentMessageId: string; kind: "orchestrated" | "direct" | "command" },
): FileRow[] {
  const pool = o.kind === "command" ? rows.filter((r) => r.messageId === o.currentMessageId) : rows;
  const sorted = [...pool].sort(runFileOrder(o.currentMessageId));
  const out: FileRow[] = [];
  let total = 0;
  for (const r of sorted) {
    if (out.length >= RUN_FILES_MAX || total + r.size > RUN_FILES_MAX_BYTES) break;
    total += r.size;
    out.push(r);
  }
  return out;
}

const ENC = new TextEncoder();
const utf8Len = (x: string): number => ENC.encode(x).length;
/** Tên trong job ≤ 120 byte UTF-8 (như `safeName` bước 5). */
const JOB_NAME_MAX_BYTES = 120;

/** `stem` bớt code point cuối tới khi `stem + tail` ≤ 120 byte; `tail` (`-k.ext`) giữ nguyên. */
function fitName(stem: string, tail: string): string {
  const cps = [...stem];
  let n = utf8Len(stem) + utf8Len(tail);
  while (cps.length > 0 && n > JOB_NAME_MAX_BYTES) n -= utf8Len(cps.pop() as string);
  return cps.join("") + tail;
}

/** Tên chưa dùng (so chữ thường): `name`, rồi `stem-2.ext`, `stem-3.ext`… */
function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const { stem, ext } = splitExt(name);
  const dotExt = ext === null ? "" : `.${ext}`;
  for (let k = 2; ; k++) {
    const cand = fitName(stem, `-${k}${dotExt}`);
    if (!taken.has(cand.toLowerCase())) return cand;
  }
}

/** Tên trong `attachments/` của job: trùng (không phân biệt hoa) → `stem-2.ext`, `stem-3.ext`…; ≤ 120 byte. */
export function jobFileNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((n) => {
    const out = freeName(n, taken);
    taken.add(out.toLowerCase());
    return out;
  });
}

/** `RunFile[]` → `payload.attachments` (tên qua `jobFileNames`); rỗng → `[]`. */
export function jobAttachments(files: readonly RunFile[]): JobAttachment[] {
  const names = jobFileNames(files.map((f) => f.name));
  return files.map((f, k) => ({
    id: f.id,
    name: names[k] ?? f.name,
    mime: f.mime,
    size: f.size,
    sha256: f.sha256,
  }));
}

/** `max(1, ceil(size / 1024))`. */
export function fileSizeKb(size: number): number {
  return Math.max(1, Math.ceil(size / 1024));
}

const fileLines = (items: readonly FileBrief[], prefix: string): string =>
  items.map((i) => `- ${prefix}${i.name} (${i.mime}, ${fileSizeKb(i.size)} KB)`).join("\n");

/** R15 · khối `<attachments>` cho prompt Orchestrator; rỗng → null. */
export function orchestratorFilesBlock(items: readonly FileBrief[]): string | null {
  if (items.length === 0) return null;
  return `<attachments>\n${fileLines(items, "")}\n</attachments>`;
}

const AGENT_FILES_INTRO =
  "The user attached these files. They are in your working directory; read them by relative path:";

/** R18 · khối `<attachments>` nối vào `prompt` job agent (đường dẫn `attachments/<name>`); rỗng → null. */
export function agentFilesBlock(items: readonly FileBrief[]): string | null {
  if (items.length === 0) return null;
  return `<attachments>\n${AGENT_FILES_INTRO}\n${fileLines(items, "attachments/")}\n</attachments>`;
}

export const OUT_HINT =
  "To return files to the user, write them directly in the out/ directory (at most 5 files, 20 MiB each).";

/** R24, PL4, PL9 · nối `OUT_HINT` vào `system_prompt` (chỉ khi job có `Write`); quá `max` (UTF-16) → giữ nguyên + `dropped`. */
export function withOutHint(system: string, max: number): { text: string; dropped: boolean } {
  const text = system ? `${system}\n\n${OUT_HINT}` : OUT_HINT;
  return text.length > max ? { text: system, dropped: true } : { text, dropped: false };
}

/** Hàng R14 → `RunFile` (`name` = `safe_name`). */
export function toRunFile(
  r: Pick<FileRow, "id" | "safeName" | "mime" | "size" | "sha256">,
): RunFile {
  return { id: r.id, name: r.safeName, mime: r.mime, size: r.size, sha256: r.sha256 };
}
