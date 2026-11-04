import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppProvider } from "../modules/community/application/ctx";
import {
  type Api,
  apiMode,
  logout,
  redeemFromLocation,
  session,
} from "../modules/community/application/runtime";
import { pickLocale, readStoredLang, setLang, t } from "../modules/community/i18n";
import { LoginPage } from "../modules/community/ui/Login";
import { Shell } from "../modules/community/ui/Shell";
import { hashRouter } from "./hash-router";

/** Đổi mã SSO (nếu đang ở `/sso`) rồi kiểm phiên cookie `ai_rt_community`. Không tự dội sang AI System: chưa có phiên ⇒ màn
 *  Đăng nhập riêng (đối tác không bao giờ cần chat-web; nội bộ có link SSO trên màn đó). */
/** Vừa vào bằng mã SSO (review thấp, login-CSRF): hiện tài khoản đang dùng + nút đăng xuất. */
let viaSso = false;

async function boot0(): Promise<string> {
  try {
    const hadCode = location.pathname === "/sso" && /[#&]code=/.test(location.hash);
    const next = await redeemFromLocation();
    viaSso = hadCode;
    if (next !== null) history.replaceState(null, "", next);
  } catch {
    if (location.pathname === "/sso") history.replaceState(null, "", "/");
  }
  return session.ensure();
}

function SsoNote() {
  const me = session.getState().me;
  const [open, setOpen] = useState(true);
  if (!me || !open) return null;
  return (
    <p className="ssonote" role="status">
      {t("community.sso.signedInAs")} <b>{me.display_name}</b> ({me.username}) ·{" "}
      <button type="button" className="linkbtn" onClick={() => void logout()}>
        {t("community.sso.notYou")}
      </button>{" "}
      <button
        type="button"
        className="linkbtn"
        onClick={() => setOpen(false)}
        aria-label={t("community.sso.close")}
      >
        ×
      </button>
    </p>
  );
}

/** C3 · adapter http: cần phiên `community` (cookie `ai_rt_community`). */
function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<string>("unknown");
  useEffect(() => {
    boot0().then(setStatus, () => setStatus("anon"));
    return session.subscribe(() => setStatus(session.getState().status));
  }, []);
  // Chưa chọn ngôn ngữ nào: theo tuỳ chọn người dùng từ `/me` (nếu có), không thì vi.
  const meLocale = status === "authed" ? session.getState().me?.locale : undefined;
  useEffect(() => {
    if (readStoredLang() === null && meLocale) void setLang(pickLocale({ me: meLocale }), false);
  }, [meLocale]);
  if (status === "authed")
    return (
      <>
        {viaSso && <SsoNote />}
        {children}
      </>
    );
  if (status === "unknown") return <div className="app" aria-busy="true" />;
  return <LoginPage />;
}
export function App({ boot }: { boot: Api }) {
  // Đổi ngôn ngữ ⇒ dựng lại cây để mọi chuỗi (đọc qua `t`) cập nhật.
  const { i18n } = useTranslation();
  const app = (
    <AppProvider boot={boot} router={hashRouter}>
      <Shell />
    </AppProvider>
  );
  return (
    <div key={i18n.language} data-mod="community">
      {apiMode === "http" ? <AuthGate>{app}</AuthGate> : app}
    </div>
  );
}
