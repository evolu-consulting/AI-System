// HD-FR-07 · HD-AC01 · PK-FR-06 · HD1 plan §2 §6 · N1 T5f (`PackFiles.link`): link tải ngắn hạn tệp gốc của HĐ. MỘT câu SQL (HĐ ⋈
// `contracts.files` chưa xoá) trong tx RLS ⇒ không có ⇒ `null`, KHÔNG gọi FileBox. Org hàng phải = `t_<tenant token>` (CHECK ở DB;
// kiểm lại — phòng thủ chiều sâu, lệch ⇒ `null` + log `pack-file-org-mismatch`). Gọi FileBox NGOÀI tx (không giữ kết nối DB khi
// chờ mạng). Log chỉ `{pack, contract_id}` — không `file_id`, không URL `/d/`. FileBox lỗi ⇒ ném (route ⇒ 5xx, không Location).
import { orgForTenant } from "../../kit/application/pack-files.ports";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ContractsReadRepo } from "./ports";

export type GetFileLink = (who: PackWho, id: string) => Promise<string | null>;

/** Xin link `/d/…` cho `fileId` ở org; FileBox báo không có ⇒ `null`. */
export type FileLinker = (org: string, fileId: string) => Promise<string | null>;

export function getFileLink(d: {
  packKey: string;
  uow: PackUow<{ contracts: Pick<ContractsReadRepo<unknown, unknown>, "fileOf"> }>;
  /** `null` = FileBox chưa cấu hình ⇒ HĐ có tệp vẫn ném (fail-closed), HĐ không thấy vẫn 404. */
  link: FileLinker | null;
  log: { warn(msg: string, fields?: Record<string, unknown>): void };
}): GetFileLink {
  return async (who, id) => {
    const ref = await d.uow.tenant(who, (r) => r.contracts.fileOf(id));
    if (!ref) return null;
    if (ref.org !== orgForTenant(who.tenantId)) {
      d.log.warn("pack-file-org-mismatch", { pack: d.packKey, contract_id: id });
      return null;
    }
    if (!d.link) throw new Error("filebox not configured");
    return d.link(ref.org, ref.fileId);
  };
}
