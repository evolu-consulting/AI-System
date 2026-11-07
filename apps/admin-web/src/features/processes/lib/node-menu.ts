// CR-123 · FLOW3-FR-12/14 · CR-125 · m6b: menu "+" / bảng node cho người dùng công ty chỉ có BƯỚC NGHIỆP VỤ (Duyệt, Nếu, Ký số, Thông báo, Kết thúc). Mọi thứ còn lại
// (Agent, Công cụ, Chuẩn bị dữ liệu, Chia/Gộp, Dify, DLC, Ghi giá trị, Hẹn giờ…) nằm ở "Nâng cao", chỉ quản trị nền tảng thấy.
// NHÓM + THỨ TỰ do chính node khai (`menu` ở `MODULES` cho node module, `FE_NODES[*].menu` cho bước cơ bản) — KHÔNG còn danh sách khoá cứng ở đây:
// node mới (module:new) tự có mặt ở menu. Thuần: nhận bảng node + node module, trả hai nhóm.
import { type AppNodeDecl, NODE_MENU_ORDER_DEFAULT } from "@ai/contracts/app-manifest";
import type { NodeEntry } from "./flow-def";

export type MenuItem = { kind: "table"; entry: NodeEntry } | { kind: "module"; node: AppNodeDecl };

export type MenuSplit = { business: MenuItem[]; advanced: MenuItem[] };

const sectionOf = (m: MenuItem): "business" | "advanced" =>
  m.kind === "table" ? m.entry.section : (m.node.menu?.section ?? "advanced");
const orderOf = (m: MenuItem): number =>
  m.kind === "table" ? m.entry.order : (m.node.menu?.order ?? NODE_MENU_ORDER_DEFAULT);

/**
 * Chia menu thành "nghiệp vụ" (ai cũng thấy) và "Nâng cao" (chỉ `isPlatform`; công ty ⇒ rỗng), mỗi nhóm xếp theo `order` (bằng nhau ⇒ giữ thứ tự khai).
 * CR-123 FR-14: "Ký số" là MỘT mục chèn cả cụm (gửi + chờ ký xong); không còn mục "Chờ ký xong" riêng.
 */
export function splitMenu(a: {
  app: string;
  isPlatform: boolean;
  table: readonly NodeEntry[];
  modules: readonly AppNodeDecl[];
}): MenuSplit {
  const items: MenuItem[] = [
    ...a.table.map((entry): MenuItem => ({ kind: "table", entry })),
    ...a.modules.map((node): MenuItem => ({ kind: "module", node })),
  ].sort((x, y) => orderOf(x) - orderOf(y));
  const business = items.filter((m) => sectionOf(m) === "business");
  if (!a.isPlatform) return { business, advanced: [] };
  return { business, advanced: items.filter((m) => sectionOf(m) === "advanced") };
}
