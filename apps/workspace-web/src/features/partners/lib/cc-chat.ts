// CR-161 · lát 8 · luật thuần của trò chuyện hai công ty: gộp trang tin (cũ → mới, không trùng), nhóm theo ngày, kiểm tệp trước khi tải,
// mã lỗi ⇒ câu dễ hiểu, đọc khung `cc.msg`. Khớp contract `company-connect.ts`.
import { ATTACH_ALLOWED, ATTACH_MAX_BYTES } from "@ai/contracts/attach";
import {
  CC_BODY_MAX,
  CC_FILES_MAX,
  type CcFile,
  type CcMessage,
  CcMsgEventDataSchema,
} from "@ai/contracts/pack-contracts";
import type { AttachItem } from "@ai/web-kit/attach-layout";

export const ATTACH_ACCEPT = Object.keys(ATTACH_ALLOWED)
  .map((e) => `.${e}`)
  .join(",");

/** Các trang (trang đầu = mới nhất) ⇒ một danh sách cũ → mới, bỏ trùng `seq`. */
export function flattenPages(pages: readonly { items: readonly CcMessage[] }[]): CcMessage[] {
  const bySeq = new Map<number, CcMessage>();
  for (const p of pages) for (const m of p.items) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export const newestSeq = (list: readonly CcMessage[]): number => list[list.length - 1]?.seq ?? 0;

/** Ngày địa phương `YYYY-MM-DD` (khoá nhóm). */
export const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Nhóm tin liên tiếp cùng ngày (giữ thứ tự). */
export function groupByDay(list: readonly CcMessage[]): { day: string; items: CcMessage[] }[] {
  const out: { day: string; items: CcMessage[] }[] = [];
  for (const m of list) {
    const day = dayKey(m.created_at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(m);
    else out.push({ day, items: [m] });
  }
  return out;
}

export type FileProblem = "type" | "size" | "empty";
/** Kiểm trước khi tải lên (máy chủ vẫn kiểm lại): null = hợp lệ. */
export function fileProblem(f: { name: string; size: number }): FileProblem | null {
  const dot = f.name.lastIndexOf(".");
  const ext = dot < 0 ? "" : f.name.slice(dot + 1).toLowerCase();
  if (!(ext in ATTACH_ALLOWED)) return "type";
  if (f.size <= 0) return "empty";
  if (f.size > ATTACH_MAX_BYTES) return "size";
  return null;
}

export type ChatErr = "type" | "size" | "readOnly" | "forbidden" | "empty" | "storage" | "failed";
const ERR_OF: Record<string, ChatErr> = {
  MSG_FILE_TYPE: "type",
  MSG_FILE_TOO_LARGE: "size",
  MSG_FILE_INVALID: "type",
  CONNECT_READ_ONLY: "readOnly",
  CONNECT_NOT_CONNECTED: "readOnly",
  PACK_FORBIDDEN: "forbidden",
  MSG_EMPTY: "empty",
  FILE_STORAGE_UNAVAILABLE: "storage",
};
/** Mã lỗi API ⇒ khoá câu báo `contracts.connect.chat.err.<khoá>` (413 ⇒ size, 415 ⇒ type kể cả khi mã lạ). */
export function chatErrKey(code: string, status?: number): ChatErr {
  if (status === 413) return "size";
  if (status === 415) return "type";
  return ERR_OF[code] ?? "failed";
}

/** Gửi được khi có chữ (sau trim) hoặc có tệp đã lên; không quá trần; không còn tệp đang tải. */
export function canSend(text: string, readyFiles: number, uploading: number): boolean {
  if (uploading > 0) return false;
  if (text.length > CC_BODY_MAX || readyFiles > CC_FILES_MAX) return false;
  return text.trim().length > 0 || readyFiles > 0;
}

export const toAttachItem = (f: CcFile): AttachItem => ({
  id: f.id,
  name: f.name,
  mime: f.mime,
  size: f.size,
});

/** Khung SSE `cc.msg` ⇒ dữ liệu hợp lệ hoặc null (hỏng/lạ ⇒ bỏ qua). */
export function parseCcMsgFrame(data: string): { tenant_id: string; seq: number } | null {
  try {
    const r = CcMsgEventDataSchema.safeParse(JSON.parse(data));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Có cần gửi «đã đọc»? Chỉ khi tin mới nhất của bên kia lớn hơn mốc đã đọc và chưa gửi mốc đó. */
export function readTarget(
  list: readonly CcMessage[],
  lastRead: number,
  sent: number,
): number | null {
  const top = newestSeq(list);
  return top > lastRead && top > sent ? top : null;
}
