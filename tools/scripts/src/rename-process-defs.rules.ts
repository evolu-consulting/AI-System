// CR-120 · luật thuần của `rename-process-defs.ts`: bảng tên mới theo khoá (tên = việc nó làm: các bước duyệt, KHÔNG mã hoá ai/khi nào —
// việc đó thuộc luật chọn quy trình) và kế hoạch đổi tên idempotent. Không I/O. Test: rename-process-defs.rules.test.ts.
import { NITI_SPEC } from "./seed-niti.data";

/** Quy trình mặc định của khe `contracts.approval` (hub 0069): cấp 1 nhóm Biên tập, cấp 2 nhóm Toàn quyền. */
export const DEFAULT_DEF_RENAME = {
  key: "hd-mac-dinh",
  name: "Duyệt 2 cấp: Biên tập → Toàn quyền",
} as const;

export type Rename = { key: string; name: string };
/** Tên mới của 3 quy trình NiTi (lấy từ seed — một nguồn) + quy trình mặc định. */
export const RENAMES: readonly Rename[] = [
  ...NITI_SPEC.processes.map((p) => ({ key: p.key, name: p.name })),
  DEFAULT_DEF_RENAME,
];

export type FoundDef = { id: string; key: string; name: string };
export type RenameStep =
  | { state: "rename"; key: string; id: string; from: string; to: string }
  | { state: "same"; key: string }
  | { state: "missing"; key: string };

/** Mỗi khoá: chưa có ⇒ missing (bỏ qua); tên đã đúng ⇒ same; khác ⇒ rename. Chạy lại sau khi áp ⇒ toàn same. */
export function planRenames(
  found: readonly FoundDef[],
  want: readonly Rename[] = RENAMES,
): RenameStep[] {
  return want.map((w): RenameStep => {
    const d = found.find((f) => f.key === w.key);
    if (!d) return { state: "missing", key: w.key };
    if (d.name === w.name) return { state: "same", key: w.key };
    return { state: "rename", key: w.key, id: d.id, from: d.name, to: w.name };
  });
}
