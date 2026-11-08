// CR-125 · S1 · C1 · bước "Xem lại" của wizard = danh sách việc còn thiếu (D7: cấu hình công ty đủ trọn). Luật thuần, không I/O:
// mỗi mục có đích "sửa" (bước wizard hoặc tab workspace). Rỗng ⇒ công ty dùng được ngay.
import type { PackState } from "@ai/contracts/packs";
import type { Attention } from "../apps/lib/apps-table";

export type ChecklistItem =
  | { kind: "noApps" }
  | { kind: "noPeople"; app: string }
  | { kind: "noUsers" }
  | { kind: "noFlow"; app: string; slot: string };

export type ChecklistInput = {
  /** App công ty đang bật (khoá app = khoá gói). */
  appsOn: readonly string[];
  /** Gói của công ty (số người trong các vai); chỉ platform_admin đọc được ⇒ vắng ⇒ bỏ qua mục "chưa ai có vai". */
  packs: readonly PackState[] | undefined;
  userCount: number;
  /** Việc quy trình đang tắt của app đang dùng (cùng nguồn dải "Cần xử lý" ở tab Ứng dụng). */
  flowsOff: readonly Attention[];
};

/** Thứ tự: app → người có vai → người dùng → quy trình. */
export function reviewChecklist(i: ChecklistInput): ChecklistItem[] {
  if (i.appsOn.length === 0) return [{ kind: "noApps" }];
  const items: ChecklistItem[] = [];
  const members = new Map((i.packs ?? []).map((p) => [p.key, p.member_count ?? 0] as const));
  for (const app of i.appsOn) {
    if (i.packs && members.has(app) && members.get(app) === 0)
      items.push({ kind: "noPeople", app });
  }
  if (i.userCount <= 1) items.push({ kind: "noUsers" });
  for (const f of i.flowsOff) items.push({ kind: "noFlow", app: f.app, slot: f.slot });
  return items;
}
