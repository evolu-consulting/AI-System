// CR-132 M5 · HD-MSG-01..12 · tệp trong tin nhắn (lớp 2, không SQL): tải lên (chưa gửi, gắn `msg_files` ngay lúc tải), tải xuống (chỉ thành viên), gỡ byte FileBox
// SAU commit khi thu hồi tin / xoá hội thoại. Byte ở FileBox (cùng kho file chính, org `t_<tenant>`); hàng `contracts.files` + `msg_files` ghi trong MỘT câu SQL.
// FileBox: put NGOÀI tx, ghi DB sau — DB không nhận ⇒ xoá byte vừa đưa lên (không mồ côi). Dọn tệp tải lên mà không gửi: TECH-DEBT.
import { ATTACH_MAX_BYTES } from "@ai/contracts/attach";
import type { FileRef } from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../../kit/public";
import { orgForTenant } from "../../../kit/public";
import { mimeByName } from "../../domain/contract-files.rules";
import { MsgFail } from "./messages.ops";
import type { MessagesRepos, MsgFileStore, StoredFile } from "./messages.ports";

export type MessagesFileOps = ReturnType<typeof messagesFileOps>;

export function messagesFileOps(d: {
  uow: PackUow<MessagesRepos>;
  files?: MsgFileStore | undefined;
  newId: () => string;
}) {
  return {
    /** Kho FileBox có cấu hình không (vắng ⇒ route tệp trả 503, tin chữ vẫn chạy). */
    filesEnabled: d.files !== undefined,

    /** Gỡ byte của các tệp đã soft-delete ở DB — SAU commit, đồng thời (≤ 10 tệp/tin; hội thoại xoá có thể nhiều hơn), lỗi nuốt: hàng DB đã đánh dấu xoá. */
    async dropBytes(files: readonly StoredFile[]): Promise<void> {
      const store = d.files;
      if (!store || files.length === 0) return;
      await Promise.allSettled(files.map((f) => store.remove(f.org, f.file_id)));
    },

    /** Thành viên (404) → đuôi nhận được (415) → dung lượng (413) → byte lên FileBox → ghi DB một câu. */
    async upload(
      who: PackWho,
      cid: string,
      f: { name: string; bytes: Uint8Array },
    ): Promise<FileRef> {
      const store = d.files;
      if (!store) throw new Error("filebox not configured");
      const facts = await d.uow.tenant(who, (r) => r.messages.facts(who.userId, cid, false));
      if (!facts) throw new MsgFail("MSG_NOT_FOUND");
      const mime = mimeByName(f.name);
      if (!mime || f.bytes.byteLength === 0) throw new MsgFail("MSG_FILE_TYPE");
      if (f.bytes.byteLength > ATTACH_MAX_BYTES) throw new MsgFail("MSG_FILE_TOO_LARGE");
      const org = orgForTenant(who.tenantId);
      const put = await store.put(org, f.name, f.bytes);
      const row = {
        id: d.newId(),
        cid,
        org,
        fileId: put.fileId,
        versionId: put.versionId,
        name: f.name,
        mime,
        size: f.bytes.byteLength,
        by: who.userId,
      };
      await d.uow
        .tenant(who, (r) => r.messages.insertFile(row))
        .catch(async (e) => {
          await store.remove(org, put.fileId).catch(() => undefined);
          throw e;
        });
      return { id: row.id, name: row.name, mime: mime as FileRef["mime"], size: row.size };
    },

    /** Link tải ngắn hạn (FileBox) cho tệp của hội thoại; không phải thành viên / không có / đã thu hồi ⇒ 404. */
    async link(who: PackWho, cid: string, fileId: string): Promise<string> {
      const store = d.files;
      if (!store) throw new Error("filebox not configured");
      const ref = await d.uow.tenant(who, (r) => r.messages.fileRef(who.userId, cid, fileId));
      if (!ref || ref.org !== orgForTenant(who.tenantId)) throw new MsgFail("MSG_NOT_FOUND");
      const url = await store.link(ref.org, ref.file_id);
      if (!url) throw new MsgFail("MSG_NOT_FOUND");
      return url;
    },
  };
}
