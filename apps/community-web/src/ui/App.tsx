import { type ReactNode, useEffect, useState } from "react";
import { apiMode, createApi } from "../api";
import { bounceToSso, redeemFromLocation, SSO_URL, session } from "../api/session";
import { ChatDock } from "./ChatDock";
import { AppProvider, useApp } from "./ctx";
import { FeedPage } from "./Feed";
import { ProfilePage } from "./Profile";
import { SettingsPage } from "./Settings";
import { TopBar } from "./TopBar";

const boot = createApi();

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

/** Đổi mã SSO (nếu đang ở `/sso`) rồi kiểm phiên; chưa có phiên ⇒ dội sang AI System một lần. */
async function boot0(): Promise<string> {
  try {
    const next = await redeemFromLocation();
    if (next !== null) history.replaceState(null, "", next);
  } catch {
    /* mã hỏng/hết hạn: thử phiên cookie như thường */
  }
  const s = await session.ensure();
  if (s !== "authed" && bounceToSso(location.pathname + location.hash)) return "unknown";
  return s;
}

/** C3 · adapter http: cần phiên `community` (cookie `ai_rt_community`, đăng nhập chung qua AI System). */
function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<string>("unknown");
  useEffect(() => {
    boot0().then(setStatus, () => setStatus("anon"));
    return session.subscribe(() => setStatus(session.getState().status));
  }, []);
  if (status === "authed") return <>{children}</>;
  if (status === "unknown") return <div className="app" aria-busy="true" />;
  return (
    <div className="app">
      <div className="card pad" role="alert">
        <p>Bạn chưa đăng nhập hoặc phiên đã hết. Đăng nhập AI System để vào Cộng đồng.</p>
        {SSO_URL && (
          <a className="primary sm" href={`${SSO_URL}/sso?app=community&next=%2F`}>
            Đăng nhập
          </a>
        )}
      </div>
    </div>
  );
}

export function App() {
  const app = (
    <AppProvider boot={boot}>
      <Shell />
    </AppProvider>
  );
  return apiMode === "http" ? <AuthGate>{app}</AuthGate> : app;
}
