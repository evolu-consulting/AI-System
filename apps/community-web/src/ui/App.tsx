import { createApi } from "../api";
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

export function App() {
  return (
    <AppProvider boot={boot}>
      <Shell />
    </AppProvider>
  );
}
