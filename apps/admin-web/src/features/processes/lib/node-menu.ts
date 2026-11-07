// CR-123 · FLOW3-FR-12: menu "+" / bảng node cho người dùng công ty chỉ có BƯỚC NGHIỆP VỤ (Duyệt, Nếu, Ký số, Chờ ký xong,
// Thông báo, Kết thúc). Mọi thứ còn lại (Agent, Công cụ, Chuẩn bị dữ liệu, Chia/Gộp, Dify, DLC, Ghi giá trị, Hẹn giờ…) nằm ở "Nâng cao",
// chỉ quản trị nền tảng thấy. Thuần: nhận bảng node + bảng node module, trả hai nhóm.
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import type { NodeEntry } from "./flow-def";

/** Bước nghiệp vụ dựng sẵn của nền tảng (theo thứ tự hiện). */
export const BUSINESS_TABLE_IDS = ["approve", "if", "waitEsign", "finish"] as const;
/** Node module nghiệp vụ: Ký số (app Hợp đồng) và Thông báo (chuông · email). */
export const BUSINESS_MODULE_KEYS = ["contracts.esign", "core.bell", "core.email"] as const;

export type MenuItem = { kind: "table"; entry: NodeEntry } | { kind: "module"; node: AppNodeDecl };

export type MenuSplit = { business: MenuItem[]; advanced: MenuItem[] };

const isBizTable = (id: string): boolean => (BUSINESS_TABLE_IDS as readonly string[]).includes(id);
const isBizModule = (key: string): boolean =>
  (BUSINESS_MODULE_KEYS as readonly string[]).includes(key);

/** "Chờ ký xong" chỉ có nghĩa ở app Hợp đồng (sự kiện ký số thuộc app này). */
const tableAllowed = (id: string, app: string): boolean =>
  id !== "waitEsign" || app === "contracts";

/**
 * Chia menu thành "nghiệp vụ" (ai cũng thấy) và "Nâng cao" (chỉ `isPlatform`; công ty ⇒ rỗng).
 * Thứ tự nghiệp vụ: Duyệt · Nếu · Ký số · Chờ ký xong · Thông báo · Kết thúc.
 */
export function splitMenu(a: {
  app: string;
  isPlatform: boolean;
  table: readonly NodeEntry[];
  modules: readonly AppNodeDecl[];
}): MenuSplit {
  const tab = (id: string) => a.table.find((n) => n.id === id);
  const table = (id: string): MenuItem[] => {
    const entry = tab(id);
    return entry && tableAllowed(id, a.app) ? [{ kind: "table", entry }] : [];
  };
  const mod = (keys: readonly string[]): MenuItem[] =>
    keys.flatMap((k) => {
      const node = a.modules.find((n) => n.key === k);
      return node ? [{ kind: "module" as const, node }] : [];
    });
  const business: MenuItem[] = [
    ...table("approve"),
    ...table("if"),
    ...mod(["contracts.esign"]),
    ...table("waitEsign"),
    ...mod(["core.bell", "core.email"]),
    ...table("finish"),
  ];
  if (!a.isPlatform) return { business, advanced: [] };
  const advanced: MenuItem[] = [
    ...a.table
      .filter((n) => !isBizTable(n.id) && n.id !== "set")
      .map((entry): MenuItem => ({ kind: "table", entry })),
    ...a.modules
      .filter((n) => !isBizModule(n.key))
      .map((node): MenuItem => ({ kind: "module", node })),
    ...a.table.filter((n) => n.id === "set").map((entry): MenuItem => ({ kind: "table", entry })),
  ];
  return { business, advanced };
}
