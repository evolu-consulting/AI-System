// CR-182 · R1 · view-model THUẦN của «Theo vai»: khoá vai sinh từ nhãn, gom vai đã có trong quy trình để chọn lại. Không React.
import type { StageDraft, StageRole } from "./draft-types";

/** Giá trị đại diện «Theo vai» trong các ô chọn người duyệt / nơi chuyển (khác mọi `u:<id>` / `g:<id>` / id nhóm). */
export const ROLE_PICK = "__role";
/** Giá trị đại diện «Vai mới…» trong ô chọn vai. */
export const ROLE_NEW = "__new";
export const ROLE_KEY_LIMIT = 40;
export const ROLE_LABEL_LIMIT = 80;
export const EMPTY_ROLE: StageRole = { key: "", label: "" };
/** Vai người ký mặc định của bước Ký (khớp `ESIGN_DEFAULT_SIGNER_ROLE` của contract). */
export const DEFAULT_SIGNER_ROLE: StageRole = {
  key: "nguoi-ky-hop-dong",
  label: "Người ký hợp đồng",
};

/** Nhãn ⇒ khoá slug (`^[a-z0-9][a-z0-9-]*$`, ≤ 40): bỏ dấu, đ ⇒ d, ký tự khác ⇒ gạch ngang. Rỗng ⇒ nhãn chưa dùng được. */
export function roleKeyOf(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ROLE_KEY_LIMIT)
    .replace(/-+$/, "");
}

/** Gõ nhãn ⇒ vai (khoá sinh từ nhãn). */
export const roleFromLabel = (label: string): StageRole => ({
  key: roleKeyOf(label),
  label: label.slice(0, ROLE_LABEL_LIMIT),
});

/** Vai đủ dùng (khoá + nhãn không rỗng) — chỉ vai đủ mới được ghi ra def. */
export const roleReady = (r: StageRole | undefined): r is StageRole =>
  !!r && r.key !== "" && r.label.trim() !== "";

/** Bản ghi ra def: bỏ khoảng trắng thừa; chưa đủ ⇒ undefined. */
export const roleToDef = (r: StageRole | undefined): StageRole | undefined =>
  roleReady(r) ? { key: r.key, label: r.label.trim() } : undefined;

/** Mọi vai đang dùng trong quy trình (Duyệt, nhóm cùng duyệt, chuyển cấp), một khoá một dòng, theo thứ tự xuất hiện. */
export function rolesOfStages(stages: readonly StageDraft[]): StageRole[] {
  const seen = new Map<string, StageRole>();
  const add = (r: StageRole | undefined) => {
    if (roleReady(r) && !seen.has(r.key)) seen.set(r.key, r);
  };
  for (const s of stages) {
    add(s.review?.role);
    for (const g of s.parallel?.groups ?? []) add(g.role);
    add(s.escalate?.role);
  }
  return [...seen.values()];
}
