// portal-home · trang chủ AI System (`/`): lời chào, "Hỏi AI", thẻ các app người dùng mở được (GET /me/apps) kèm vài con số,
// chọn app mặc định. Thanh trên = thanh chung của 4 web. Mỗi nguồn số lỗi chỉ ẩn số của thẻ đó.
import { withCurrent } from "@ai/web-kit/app-catalog/apps";
import { tileNumbers } from "@ai/web-kit/app-catalog/portal";
import { TopShell } from "@ai/web-kit/ui/TopShell";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { logout } from "~/features/auth/api";
import { AppSwitcher } from "~/features/shell/components/AppSwitcher";
import { useSession } from "~/lib/auth/use-session";
import { AppTile } from "../components/AppTile";
import { AskBox } from "../components/AskBox";
import { DefaultAppPicker } from "../components/DefaultAppPicker";
import { RecentChats } from "../components/RecentChats";
import {
  useAdminNumbers,
  useContractsNumbers,
  usePortalApps,
  usePortalInfo,
} from "../hooks/use-portal";

export function PortalPage() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const apps = usePortalApps(me?.id);
  const info = usePortalInfo();
  const contracts = useContractsNumbers(apps.data);
  const admin = useAdminNumbers();
  // Chat AI luôn có thẻ (cùng origin, mở được dù catalog chưa điền URL).
  const list = apps.data ? withCurrent(apps.data, "chat") : [];
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <TopShell
        start={<span className="truncate text-sm font-semibold">{t("portal.title")}</span>}
        apps={<AppSwitcher current="portal" />}
        end={
          <Button type="button" variant="ghost" size="sm" onClick={() => void logout()}>
            {t("settings.logout")}
          </Button>
        }
      />
      <main
        id="main"
        className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
      >
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">
            {t("portal.greeting", { name: me?.display_name ?? "" })}
          </h1>
          <p className="text-sm text-muted-foreground">{t("portal.sub")}</p>
        </header>
        <AskBox />
        {apps.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("portal.appsFailed")}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="portal-tiles">
          {list.map((a) => (
            <AppTile
              key={a.key}
              app={a}
              numbers={tileNumbers(a.key, { contracts: contracts.data, admin })}
            >
              {a.key === "chat" && <RecentChats />}
            </AppTile>
          ))}
        </div>
        {apps.data && info.data && <DefaultAppPicker apps={list} info={info.data} />}
      </main>
    </div>
  );
}
