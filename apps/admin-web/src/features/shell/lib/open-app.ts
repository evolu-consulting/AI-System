// admin-sso-bounce · link từ admin-web sang app khác (ngoài app switcher, vd "Cấu hình trong Sổ Hợp Tác" ở màn Agents) phải chuyển
// phiên bằng mã một lần như switcher. Link thẳng `app.url` ⇒ web đích không có phiên ⇒ dội sang AI System (chat-web), nơi người chỉ
// đăng nhập admin-web không có phiên ⇒ hiện form đăng nhập. Luật thuần: không đọc DOM/phiên — người gọi truyền vào.
import type { MeApp } from "@ai/contracts/app-catalog";
import { handOffUrl } from "@ai/web-kit/auth/sso";

export type HandOffDeps = {
  authed: boolean;
  grant: (app: string) => Promise<{ code: string; target_url: string }>;
};

/** URL để mở `app`: app có SSO ⇒ `<target_url>/sso#code=…` (lỗi/không phiên ⇒ form đăng nhập của đích); không SSO ⇒ `app.url`. */
export async function appOpenUrl(app: MeApp, next: string, d: HandOffDeps): Promise<string> {
  if (!app.sso) return app.url;
  const url = await handOffUrl({
    authed: d.authed,
    grant: () => d.grant(app.key),
    fallbackBase: app.url,
    next,
  });
  return url ?? app.url;
}
