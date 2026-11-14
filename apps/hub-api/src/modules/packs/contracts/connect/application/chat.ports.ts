// CR-161 · lát 6 · cổng (port) của use case trò chuyện: adapter `chat.repo.ts` cài, `connect.mount.ts` tiêm. Lớp 2 — chỉ kiểu.
import type { CcFile, CcMessage } from "@ai/contracts/pack-contracts";
import type { CcOwner } from "./connect.ports";

export type ChatPage = { read_only: boolean; last_read_seq: number; items: CcMessage[] };
export type ChatSent = { seq: number; created: boolean; message: CcMessage; notify: CcOwner[] };
/** `id` = uuid dòng `cc_files` (route sinh, khoá `<tenant>/<id>`); `boxId` = `file_id` FileBox (16 hex thật, không phải uuid). */
export type ChatFileNew = {
  id: string;
  boxId: string;
  name: string;
  mime: string;
  size: number;
  key: string;
};
/** Nơi lưu nội dung: khoá (`<tenant bên tải>/<id>` ⇒ org FileBox) + id FileBox. */
export type ChatFileRef = { key: string; boxId: string };

/** Mỗi hàm = MỘT câu gọi hàm DEFINER hub 0146 (người dùng = `app.user_id` do scope đặt). */
export interface ChatRepo {
  page(other: string, before: number | null, limit: number): Promise<ChatPage>;
  send(
    other: string,
    clientId: string,
    userName: string,
    body: string,
    fileIds: readonly string[],
  ): Promise<ChatSent>;
  markRead(other: string, seq: number): Promise<number>;
  connected(other: string): Promise<boolean>;
  fileAdd(other: string, f: ChatFileNew): Promise<CcFile>;
  /** Nơi lưu nội dung; người ngoài cặp / tệp đã xoá / chưa gắn của người khác ⇒ null. */
  fileRef(fileId: string): Promise<ChatFileRef | null>;
}

/** Kho nội dung (FileBox, org theo công ty bên tải). */
export type ChatFileStore = {
  put(org: string, name: string, bytes: Uint8Array): Promise<{ fileId: string; versionId: string }>;
  remove(org: string, fileId: string): Promise<void>;
  link(org: string, fileId: string): Promise<string | null>;
};

export type SweptFile = { id: string; key: string; boxId: string };
/** Việc nền (scope system): soft-delete tệp chưa gắn tin quá hạn, trả khoá + id FileBox để xoá nội dung. */
export type ChatSweepClaim = () => Promise<SweptFile[]>;
