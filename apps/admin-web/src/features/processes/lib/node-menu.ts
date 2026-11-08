// CR-123 · FLOW3-FR-12/14 · CR-125 · m6b: menu "+" / bảng node cho người dùng công ty chỉ có BƯỚC NGHIỆP VỤ (Duyệt, Nếu, Ký số, Thông báo, Kết thúc). Mọi thứ còn lại
// (Agent, Công cụ, Chuẩn bị dữ liệu, Chia/Gộp, Dify, DLC, Ghi giá trị, Hẹn giờ…) nằm ở "Nâng cao", chỉ quản trị nền tảng thấy.
// NHÓM + THỨ TỰ do chính node khai (`menu` ở `MODULES` cho node module, `FE_NODES[*].menu` cho bước cơ bản) — KHÔNG còn danh sách khoá cứng ở đây:
// node mới (module:new) tự có mặt ở menu. Thuần: nhận bảng node + node module, trả hai nhóm.
// CR-125 · c6: MỘT nơi lọc theo flow — node thuộc app khác không hiện (sổ MODULES nói node của app nào), node có kết quả Kết thúc mà
// sự kiện không khai cũng không hiện; mục Kết thúc tách theo từng kết quả của sự kiện (community: Hiện bài / Ẩn bài).
import {
  type AppEventDecl,
  type AppNodeDecl,
  NODE_MENU_ORDER_DEFAULT,
} from "@ai/contracts/app-manifest";
import { MODULES } from "@ai/contracts/modules";
import type { NodeEntry } from "./flow-def";

export type MenuItem = { kind: "table"; entry: NodeEntry } | { kind: "module"; node: AppNodeDecl };

export type MenuSplit = { business: MenuItem[]; advanced: MenuItem[] };

const sectionOf = (m: MenuItem): "business" | "advanced" =>
  m.kind === "table" ? m.entry.section : (m.node.menu?.section ?? "advanced");
const orderOf = (m: MenuItem): number =>
  m.kind === "table" ? m.entry.order : (m.node.menu?.order ?? NODE_MENU_ORDER_DEFAULT);

/** App chủ của node theo sổ MODULES; `core` / node không có trong sổ (Dify, DLC…) ⇒ dùng được ở mọi app. */
const OWNER_OF = new Map(MODULES.flatMap((m) => m.nodes.map((n) => [n.key, m.app] as const)));
export const ownerAppOf = (key: string): string | undefined => OWNER_OF.get(key);

/** Node có dùng được cho flow của `app` + `event` không: đúng app (hoặc lõi) và mọi Kết thúc đặt sẵn đều là kết quả của sự kiện. */
export function nodeFitsFlow(
  n: AppNodeDecl,
  app: string,
  event: AppEventDecl | undefined,
): boolean {
  const owner = ownerAppOf(n.key);
  if (owner !== undefined && owner !== "core" && owner !== app) return false;
  if (!event) return true;
  const outs = new Set(event.outcomes.map((o) => o.key));
  return n.stages.every((s) => s.outcome === undefined || outs.has(s.outcome));
}

/** Mục Kết thúc chung ⇒ MỘT mục cho mỗi kết quả của sự kiện ("Kết thúc · Hiện bài", "Kết thúc · Ẩn bài"); sự kiện vắng/không kết quả ⇒ giữ nguyên. */
export function withOutcomeEnds(
  table: readonly NodeEntry[],
  event: AppEventDecl | undefined,
): NodeEntry[] {
  const outs = event?.outcomes ?? [];
  return table.flatMap((e) =>
    e.id === "finish" && outs.length > 0
      ? outs.map((o): NodeEntry => ({ ...e, outcome: { key: o.key, label: o.label } }))
      : [e],
  );
}

/**
 * Chia menu thành "nghiệp vụ" (ai cũng thấy) và "Nâng cao" (chỉ `isPlatform`; công ty ⇒ rỗng), mỗi nhóm xếp theo `order` (bằng nhau ⇒ giữ thứ tự khai).
 * CR-123 FR-14: "Ký số" là MỘT mục chèn cả cụm (gửi + chờ ký xong); không còn mục "Chờ ký xong" riêng.
 */
export function splitMenu(a: {
  app: string;
  isPlatform: boolean;
  table: readonly NodeEntry[];
  modules: readonly AppNodeDecl[];
  /** Sự kiện của flow: lọc node theo kết quả Kết thúc + tách mục Kết thúc theo kết quả. Vắng ⇒ chỉ lọc theo app. */
  event?: AppEventDecl | undefined;
}): MenuSplit {
  const items: MenuItem[] = [
    ...withOutcomeEnds(a.table, a.event).map((entry): MenuItem => ({ kind: "table", entry })),
    ...a.modules
      .filter((n) => nodeFitsFlow(n, a.app, a.event))
      .map((node): MenuItem => ({ kind: "module", node })),
  ].sort((x, y) => orderOf(x) - orderOf(y));
  const business = items.filter((m) => sectionOf(m) === "business");
  if (!a.isPlatform) return { business, advanced: [] };
  return { business, advanced: items.filter((m) => sectionOf(m) === "advanced") };
}
