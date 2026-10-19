// PK-FR-06 · D-07 · ADR-0015 · N1 plan §6: cổng file của gói — FileBox `org = t_<tenant_id>` (mỗi tenant một org, cách ly ở
// FileBox lẫn ở hàng `<k>.files` có CHECK `org = 't_' || tenant_id`). API gói chỉ lộ `id` HÀNG, không bao giờ `file_id`/URL.
// Lớp 2 — chỉ kiểu + hàm thuần, không import gì ngoài domain/application.
import type { PackWho } from "./ports";

/** Org FileBox của tenant (thuần; khớp CHECK `files_org_ck` ở DB). */
export const orgForTenant = (tenantId: string): string => `t_${tenantId}`;

export type PackFileNew = { name: string; mime: string; bytes: Uint8Array };

/** Hàng `<k>.files` đọc trong tx RLS của tenant (chưa xoá mềm). */
export type PackFileRow = { id: string; org: string; fileId: string };

/** Repo `<k>.files` trong tx `PackUow` (lọc `tenant_id` tường minh ngoài RLS). */
export type PackFilesRepo = {
  find(rowId: string): Promise<PackFileRow | null>;
  insert(row: {
    id: string;
    org: string;
    fileId: string;
    versionId: string;
    name: string;
    mime: string;
    sizeBytes: number;
    createdBy: string;
  }): Promise<void>;
  /** Xoá mềm (`deleted_at`); trả hàng vừa xoá hoặc null nếu không có / đã xoá. */
  softDelete(rowId: string): Promise<PackFileRow | null>;
};

export type PackFiles = {
  /** Đưa byte lên FileBox (org của tenant) rồi ghi hàng ⇒ `id` hàng. */
  put(who: PackWho, file: PackFileNew): Promise<{ id: string }>;
  /** URL tải ngắn hạn (`/d/…`) cho hàng của CHÍNH tenant; hàng lạ/tenant khác/đã xoá ⇒ null (không gọi FileBox). */
  link(who: PackWho, rowId: string): Promise<string | null>;
  /** Xoá mềm hàng + xoá file ở FileBox; không thấy ⇒ false. */
  remove(who: PackWho, rowId: string): Promise<boolean>;
};
