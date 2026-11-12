// CR-127 · X3 · spec §4 (hold/release, yêu cầu thay đổi), R#18 (vai), BR-41, BR-52, BR-53, BR-76 — luật THUẦN (không DB, không giờ).
// Vai: tạm khoá/mở khoá = người phụ trách HĐ ∪ trưởng phòng của người phụ trách ∪ quản trị công ty; yêu cầu thay đổi = người phụ trách ∪ quản trị
// (người được uỷ quyền / người giữ task Xác nhận mốc nối ở E3/X5). HĐ chưa có người phụ trách ⇒ người tạo thay.
import type { ExecKind } from "@ai/contracts/pack-contracts";

export type ExecActor = {
  userId: string;
  owner: string | null;
  createdBy: string;
  /** Người gọi là trưởng của phòng người phụ trách. */
  head: boolean;
  /** Quản trị công ty (quyền `admin` của gói). */
  admin: boolean;
};

const ownerOf = (a: Pick<ExecActor, "owner" | "createdBy">) => a.owner ?? a.createdBy;

export const mayHold = (a: ExecActor): boolean => a.admin || a.userId === ownerOf(a) || a.head;
export const mayChange = (a: ExecActor): boolean => a.admin || a.userId === ownerOf(a);

/** Tạm khoá có nghĩa khi HĐ DONE (không bị thay thế) còn hiệu lực (đang hiệu lực / sắp hết hạn). */
const HOLDABLE_EFFECTS: ReadonlySet<string> = new Set(["active", "expiring"]);
export const holdable = (c: {
  status: string;
  superseded: boolean;
  effect: string | null;
}): boolean =>
  c.status === "done" && !c.superseded && c.effect !== null && HOLDABLE_EFFECTS.has(c.effect);

/** Số ngày lịch từ `was` tới `to` (`YYYY-MM-DD`). */
export function daysBetween(was: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${was}T00:00:00Z`)) / 86_400_000);
}

/** Dữ kiện quy trình `fulfilment.change_requested` (manifest: `kind` hold|postpone|split|waive, `postpone_days`, `waive_amount`). */
export type ChangeFacts = {
  kind: "hold" | "postpone" | "split" | "waive";
  postpone_days?: number;
  waive_amount?: number;
};
export function factsOf(
  kind: ExecKind,
  p: { days?: number | null; waive?: number | null },
): ChangeFacts {
  if (kind === "postpone") return { kind, ...(p.days == null ? {} : { postpone_days: p.days }) };
  if (kind === "split") return { kind };
  if (kind === "waive_penalty")
    return { kind: "waive", ...(p.waive == null ? {} : { waive_amount: p.waive }) };
  return { kind: "hold" }; // mở khoá cùng nhóm quy tắc với tạm khoá (BR-41)
}

/** HĐ DONE khoá sửa mốc: chỉ `due_date` đi qua yêu cầu dời hạn; mọi giá trị khác (loại, SL, %, tiền, bảng SL, tên, việc của ai) ⇒ phiên bản mới (BR-53). */
export type PatchRoute = "postpone" | "use_new_version";
export function patchRouteOf(keys: readonly string[]): PatchRoute {
  const k = keys.filter((x) => x !== "evidence");
  return k.length === 1 && k[0] === "due_date" ? "postpone" : "use_new_version";
}
