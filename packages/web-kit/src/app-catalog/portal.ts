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
  chat = true,
): Landing {
  if (!chat) return noChatLanding(effective, apps);
  if (home || !effective || effective === HOME_KEY) return { kind: "portal" };
  if (effective === "chat") return { kind: "chat" };
  const app = apps.find((a) => a.key === effective && a.url !== "");
  return app ? { kind: "app", app } : { kind: "portal" };
}

/**
 * app-perm · người dùng KHÔNG dùng được Chat AI (công ty bị thu hồi `chat-app`): trang chủ/chat trên origin Chat AI là ngõ cụt
 * ⇒ bỏ qua `?home=1`, vào app mặc định nếu mở được, không thì app đầu tiên mở được (vd Sổ Hợp Tác). Không có app nào ⇒ trang chủ.
 */
export function noChatLanding(
  effective: string | null | undefined,
  apps: readonly MeApp[],
): Landing {
  const usable = apps.filter((a) => a.key !== "chat" && a.url !== "");
  const app = usable.find((a) => a.key === effective) ?? usable[0];
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
  pendingFeedback: number;
} | null {
  return portal?.admin
    ? { newUsers7d: portal.admin.new_users_7d, pendingFeedback: portal.admin.pending_feedback }
    : null;
}

export type TileNumber = {
  key: "todo" | "expiring30" | "newUsers7d" | "pendingFeedback";
  value: number;
};

/** Con số nên hiện trên thẻ, theo thứ tự; số 0 vẫn hiện (biết là "không có việc"). */
export function tileNumbers(
  appKey: string,
  d: {
    contracts?: { todo: number; expiring30: number } | null;
    admin?: { newUsers7d: number; pendingFeedback: number } | null;
  },
): TileNumber[] {
  if (appKey === "contracts" && d.contracts)
    return [
      { key: "todo", value: d.contracts.todo },
      { key: "expiring30", value: d.contracts.expiring30 },
    ];
  if (appKey === "admin" && d.admin)
    return [
      { key: "newUsers7d", value: d.admin.newUsers7d },
      { key: "pendingFeedback", value: d.admin.pendingFeedback },
    ];
  return [];
}
