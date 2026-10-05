// HUB-FR-44 · WRK-FR-11 · H2c-R14, R15, R18, R24 · tập file của run, tên file trong job, khối file trong prompt
// (plan-rules §3). B0: chỉ chữ ký (thân ném `not implemented`) — B4/B6.
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

/** R14: `command` → chỉ tin hiện tại; sắp tin hiện tại trước, rồi mới → cũ; dừng ở file thứ 11 hoặc khi tổng > 100 MiB. */
export function pickRunFiles(
  _rows: readonly FileRow[],
  _o: { currentMessageId: string; kind: "orchestrated" | "direct" | "command" },
): FileRow[] {
  throw new Error("not implemented: pickRunFiles");
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
