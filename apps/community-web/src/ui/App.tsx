import { type ReactNode, useEffect, useState } from "react";
import { type Api, apiMode } from "../api";
import { logout } from "../api/auth";
import { redeemFromLocation, session } from "../api/session";
import { ChatDock } from "./ChatDock";
import { AppProvider, useApp } from "./ctx";
import { FeedPage } from "./Feed";
import { LoginPage } from "./Login";
import { ProfilePage } from "./Profile";
import { SettingsPage } from "./Settings";
import { TopBar } from "./TopBar";

function Shell() {
  const { route } = useApp();
  return (
    <div className="app">
      <TopBar />
      {route.name === "feed" && <FeedPage />}
      {route.name === "profile" && <ProfilePage />}
      {route.name === "settings" && <SettingsPage />}
      <ChatDock />
    </div>
  );
}

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
      Đang đăng nhập: <b>{me.display_name}</b> ({me.username}) ·{" "}
      <button type="button" className="linkbtn" onClick={() => void logout()}>
        Không phải bạn? Đăng xuất
      </button>{" "}
      <button type="button" className="linkbtn" onClick={() => setOpen(false)} aria-label="Đóng">
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
  const app = (
    <AppProvider boot={boot}>
      <Shell />
    </AppProvider>
  );
  return apiMode === "http" ? <AuthGate>{app}</AuthGate> : app;
}
