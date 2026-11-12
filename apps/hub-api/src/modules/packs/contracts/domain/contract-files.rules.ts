// CR-133 · «Tài liệu kèm» trên HĐ — luật thuần (không đọc DB): đuôi tệp nhận được, ai gắn/gỡ, gom hai nhóm tệp của một HĐ.
import { ATTACH_ALLOWED } from "@ai/contracts/attach";
import type { DeleteRole } from "./delete-contract.rules";

/** Trần số tệp gắn thẳng vào một HĐ (chặn lạm dụng kho; số khác ⇒ sửa ở đây). */
export const MAX_CONTRACT_FILES = 20;

export type ContractFileFacts = { created_by: string; owner_user_id: string | null };

/** MIME theo đuôi tên tệp (danh sách `ATTACH_ALLOWED`, không tin MIME khai báo); đuôi lạ / không có ⇒ null (415). */
export function mimeByName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(ATTACH_ALLOWED, ext)
    ? ATTACH_ALLOWED[ext as keyof typeof ATTACH_ALLOWED]
    : null;
}

/** Danh sách đuôi nhận được, viết cho người dùng (câu lỗi 415). */
export const acceptedExtensions = (): string =>
  Object.keys(ATTACH_ALLOWED)
    .map((e) => e.toUpperCase())
    .join(", ");

/** Người có quyền sửa HĐ: quản trị gói, hoặc (có quyền ghi gói) người tạo / người phụ trách. */
export function canEditContractFiles(
  f: ContractFileFacts,
  actor: string,
  role: DeleteRole,
): boolean {
  if (role.admin) return true;
  return role.write && (actor === f.created_by || actor === f.owner_user_id);
}

/** Gắn: người có quyền sửa HĐ. Gỡ: người có quyền sửa HĐ HOẶC chính người đã gắn tệp đó (vẫn cần quyền ghi gói). */
export const canAddContractFile = canEditContractFiles;
export function canRemoveContractFile(
  f: ContractFileFacts,
  addedBy: string,
  actor: string,
  role: DeleteRole,
): boolean {
  if (canEditContractFiles(f, actor, role)) return true;
  return role.write && actor === addedBy;
}

export type OwnFileRow = {
  id: string;
  name: string;
  mime: string;
  size_bytes: number | string;
  added_by: string;
  added_at: Date | string;
};
export type StepFileRow = {
  id: string;
  name: string;
  mime: string;
  size: number | string;
  source: string;
  added_at: Date | string;
};

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/** Gom hai nhóm vào MỘT khối: (1) tệp gắn vào HĐ (kèm `can_remove`), (2) tệp kèm các bước duyệt (chỉ đọc). */
export function groupContractFiles(
  own: readonly OwnFileRow[],
  steps: readonly StepFileRow[],
  canRemove: (addedBy: string) => boolean,
) {
  return {
    files: own.map((r) => ({
      id: r.id,
      name: r.name,
      mime: r.mime,
      size: Number(r.size_bytes),
      added_by: r.added_by,
      added_at: iso(r.added_at),
      can_remove: canRemove(r.added_by),
    })),
    steps: steps.map((r) => ({
      id: r.id,
      name: r.name,
      mime: r.mime,
      size: Number(r.size),
      source: r.source,
      added_at: iso(r.added_at),
    })),
  };
}
