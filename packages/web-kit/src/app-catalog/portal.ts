// portal-home · luật thuần của trang chủ AI System: nơi đăng nhập hạ cánh (app mặc định) và con số trên thẻ app. Không I/O.
import type { MeApp, PortalResponse } from "@ai/contracts";
import { HOME_KEY } from "./apps";

export type Landing = { kind: "portal" } | { kind: "chat" } | { kind: "app"; app: MeApp };

/**
 * Sau đăng nhập ở chat-web (`/`): có `?home=1` ⇒ trang chủ; `effective` (server đã lọc theo quyền) là Chat AI ⇒ vào chat; là app khác
 * có trong danh sách ⇒ chuyển phiên sang app đó; không có/không khớp ⇒ trang chủ. Lỗi lấy mặc định ⇒ gọi với `effective = null`.
 */
export function landingFor(
  effective: string | null | undefined,
  apps: readonly MeApp[],
  home: boolean,
): Landing {
  if (home || !effective || effective === HOME_KEY) return { kind: "portal" };
  if (effective === "chat") return { kind: "chat" };
  const app = apps.find((a) => a.key === effective && a.url !== "");
  return app ? { kind: "app", app } : { kind: "portal" };
}

export type TodoLike = {
  counts: { total: number };
  items: readonly { kind: string; days: number }[];
};
/** Sổ Hợp Tác: "Cần xử lý" + HĐ sắp hết hạn trong 30 ngày (từ cùng `my-work/todo`, đúng quyền người gọi). */
export function contractsNumbers(todo: TodoLike): { todo: number; expiring30: number } {
  const expiring30 = todo.items.filter(
    (i) => i.kind === "contract_expiring" && i.days <= 30,
  ).length;
  return { todo: todo.counts.total, expiring30 };
}

/** Chat AI: tối đa `n` hội thoại gần nhất (server đã sắp theo `updated_at` giảm dần; sắp lại cho chắc). */
export function recentConversations<T extends { updated_at: string }>(
  items: readonly T[],
  n = 3,
): T[] {
  return [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, n);
}

/** Quản trị: người dùng mới 7 ngày (chỉ khi server trả khối `admin`). */
export function adminNumbers(portal: Pick<PortalResponse, "admin"> | null | undefined): {
  newUsers7d: number;
} | null {
  return portal?.admin ? { newUsers7d: portal.admin.new_users_7d } : null;
}

export type TileNumber = { key: "todo" | "expiring30" | "newUsers7d"; value: number };

/** Con số nên hiện trên thẻ, theo thứ tự; số 0 vẫn hiện (biết là "không có việc"). */
export function tileNumbers(
  appKey: string,
  d: {
    contracts?: { todo: number; expiring30: number } | null;
    admin?: { newUsers7d: number } | null;
  },
): TileNumber[] {
  if (appKey === "contracts" && d.contracts)
    return [
      { key: "todo", value: d.contracts.todo },
      { key: "expiring30", value: d.contracts.expiring30 },
    ];
  if (appKey === "admin" && d.admin) return [{ key: "newUsers7d", value: d.admin.newUsers7d }];
  return [];
}
