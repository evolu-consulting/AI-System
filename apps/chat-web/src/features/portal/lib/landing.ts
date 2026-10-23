// portal-home · quyết định nơi hạ cánh của `/` (I/O mỏng quanh `landingFor` thuần); mọi lỗi ⇒ trang chủ.
// app-perm · người không dùng được Chat AI (`portal.chat === false`) ⇒ luôn chuyển sang app mặc định / app đầu tiên mở được.
import { type Landing, landingFor } from "@ai/web-kit/app-catalog/portal";
import { session } from "~/lib/auth/session";
import { fetchPortal } from "../api";

export async function decideLanding(home: boolean): Promise<Landing> {
  try {
    const info = await fetchPortal();
    const chat = info.chat !== false;
    if (home && chat) return { kind: "portal" };
    const effective = info.default_app.effective;
    if (chat && (!effective || effective === "chat")) return landingFor(effective, [], false);
    const apps = (await session.myApps()).items;
    return landingFor(effective, apps, false, chat);
  } catch {
    return { kind: "portal" };
  }
}

/**
 * app-perm · route Chat AI (`/c/*`, phòng, thông báo…) cho người không dùng được Chat AI ⇒ `true` = chuyển về `/` (nơi đó chuyển
 * phiên sang app của họ). Hỏi một lần mỗi user trong phiên tab; lỗi API ⇒ `false` (không chặn — hành vi cũ).
 */
let cached: { user: string; denied: Promise<boolean> } | null = null;
export function chatDenied(userId: string): Promise<boolean> {
  if (cached?.user !== userId) {
    const denied = fetchPortal()
      .then((p) => p.chat === false)
      .catch(() => false);
    cached = { user: userId, denied };
  }
  return cached.denied;
}
