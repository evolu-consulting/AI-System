// PK-FR-10 · TF4 · CR-118 · guard route (plan-frontend §1): vùng cần đăng nhập (SHT `_authed`, `/community`): tải trang → refresh
// cookie một lần; không có phiên ⇒ path SHT thử phiên AI System (sso-switch) rồi `/login?next=`, `/community*` thẳng `/login`
// (không dội — đối tác không có chat-web). Có phiên nhưng module không mở được (đối tác gõ path SHT) ⇒ home theo quyền, trước khi
// tải chunk route. Vào `/login` khi đã có phiên ⇒ home theo quyền.
import { redirect } from "@tanstack/react-router";
import {
  type AccessCaps,
  bouncesToSso,
  canOpen,
  currentCaps,
  homeFor,
  moduleOf,
  session,
  setAppsSource,
  setHomeSource,
} from "~/platform/auth";
import { bounceToSso } from "./sso";

// CR-118: quyền mở module lấy từ `/pack/me.apps` (FeatureGate, nạp động để OpenFeature không vào bundle đầu); lỗi ⇒ `currentCaps` suy từ `me.kind`.
setAppsSource(async () => {
  const m = await import("~/platform/features");
  // Đối tác (user ngoài): Hub chặn `/me/stream` ⇒ không mở (tránh 403 mỗi lần vào Bảng tin). Đặt trước khi nguồn cờ bắt đầu nghe.
  m.setStreamGate(() => session.getState().me?.kind !== "external");
  return m.featureAppsSource();
});
setHomeSource(async () => (await import("~/platform/features")).featureHomeSource());

type Loc = { href: string };

/** Hằng lúc build (rsbuild define): mock Community (dev/e2e không backend) ⇒ `/community*` không cần phiên, không /pack/me. */
declare const __COMMUNITY_MOCK__: boolean | undefined;

/**
 * Không mở được và home ở module khác ⇒ về home (cùng module ⇒ để trang hiện trạng thái "chưa bật gói", tránh vòng).
 * Ngoại lệ (ADR-0044): nhân viên nội bộ vào `/community` khi Bảng tin chưa được bật KHÔNG bị đẩy về Tổng quan — trang nói rõ vì sao
 * («Bảng tin chưa được bật cho công ty — liên hệ quản trị nền tảng»); đối tác (không có Sổ Hợp Tác) vẫn về home.
 */
export function bouncesHome(href: string, caps: AccessCaps, home: string): boolean {
  if (canOpen(href, caps) || moduleOf(home) === moduleOf(href)) return false;
  return !(caps.contracts && moduleOf(href) === "community");
}

export async function requireSession(location: Loc): Promise<void> {
  if (
    typeof __COMMUNITY_MOCK__ !== "undefined" &&
    __COMMUNITY_MOCK__ &&
    /\/community(?:[/?#]|$)/.test(location.href)
  )
    return;
  const status = await session.ensure();
  if (status !== "authed" || !session.getState().me) {
    // sso-switch: thử phiên AI System trước khi hỏi mật khẩu; đang rời trang ⇒ treo router tới khi trình duyệt chuyển.
    if (bouncesToSso(location.href) && bounceToSso(location.href))
      await new Promise<never>(() => {});
    throw redirect({ to: "/login", search: { next: location.href } });
  }
  const caps = await currentCaps();
  const home = homeFor(caps);
  if (bouncesHome(location.href, caps, home)) throw redirect({ href: home, replace: true });
}

/** `/`: home theo quyền khi có phiên; chưa có ⇒ Tổng quan (guard SHT lo đăng nhập/dội như nay). */
export async function homeRedirect(): Promise<never> {
  const status = await session.ensure();
  const authed = status === "authed" && Boolean(session.getState().me);
  throw redirect({ href: authed ? homeFor(await currentCaps()) : "/contracts", replace: true });
}

export async function redirectIfAuthed(): Promise<void> {
  const status = await session.ensure();
  if (status === "authed" && session.getState().me)
    throw redirect({ href: homeFor(await currentCaps()) });
}
