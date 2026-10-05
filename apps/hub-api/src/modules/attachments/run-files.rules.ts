// HUB-FR-44 · WRK-FR-11 · H2c-R14, R15, R18, R24 · tập file của run, tên file trong job, khối file trong prompt
// (plan-rules §3). B4: `pickRunFiles`; phần còn lại B0 chỉ chữ ký (thân ném `not implemented`) — B6.
import type { AttachMime } from "@ai/contracts/chat";
import type { JobAttachment } from "@ai/contracts/hub";

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

/** Tên trong `attachments/` của job: trùng (không phân biệt hoa) → `stem-2.ext`, `stem-3.ext`…; ≤ 120 byte. */
export function jobFileNames(_names: readonly string[]): string[] {
  throw new Error("not implemented: jobFileNames");
}

/** `RunFile[]` → `payload.attachments` (tên qua `jobFileNames`); rỗng → `[]`. */
export function jobAttachments(_files: readonly RunFile[]): JobAttachment[] {
  throw new Error("not implemented: jobAttachments");
}

/** `max(1, ceil(size / 1024))`. */
export function fileSizeKb(_size: number): number {
  throw new Error("not implemented: fileSizeKb");
}

/** R15 · khối `<attachments>` cho prompt Orchestrator; rỗng → null. */
export function orchestratorFilesBlock(_items: readonly FileBrief[]): string | null {
  throw new Error("not implemented: orchestratorFilesBlock");
}

/** R18 · khối `<attachments>` nối vào `prompt` job agent (đường dẫn `attachments/<name>`); rỗng → null. */
export function agentFilesBlock(_items: readonly FileBrief[]): string | null {
  throw new Error("not implemented: agentFilesBlock");
}

export const OUT_HINT =
  "To return files to the user, write them directly in the out/ directory (at most 5 files, 20 MiB each).";

/** R24, PL4, PL9 · nối `OUT_HINT` vào `system_prompt` (chỉ khi job có `Write`); quá `max` (UTF-16) → giữ nguyên + `dropped`. */
export function withOutHint(_system: string, _max: number): { text: string; dropped: boolean } {
  throw new Error("not implemented: withOutHint");
}

/** Hàng R14 → `RunFile` (`name` = `safe_name`). */
export function toRunFile(
  r: Pick<FileRow, "id" | "safeName" | "mime" | "size" | "sha256">,
): RunFile {
  return { id: r.id, name: r.safeName, mime: r.mime, size: r.size, sha256: r.sha256 };
}
