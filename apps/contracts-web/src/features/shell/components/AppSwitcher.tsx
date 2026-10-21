// V2-GAPS · nút "Ứng dụng": về AI System / Quản trị. Mỗi mục là link thật tới `/sso?app=…` của chính contracts-web (xin mã một lần ⇒ sang
// app đích đã đăng nhập sẵn, không đăng nhập lại) — cùng cơ chế với chat-web (`@ai/web-kit/auth/sso`).
import { useTranslation } from "react-i18next";
import { IconApps } from "~/components/icons";
import { APP_URLS, type SwitchApp, visibleApps } from "../lib/apps";
import { Popover } from "./Popover";

const LABEL: Record<SwitchApp, string> = {
  chat: "contracts.vgaps.apps.chat",
  admin: "contracts.vgaps.apps.admin",
};

export function AppSwitcher({ role }: { role: string | undefined }) {
  const { t } = useTranslation();
  const apps = visibleApps({ urls: APP_URLS, role });
  if (apps.length === 0) return null;
  return (
    <Popover
      label={t("contracts.vgaps.apps.title")}
      role="menu"
      button={<IconApps className="mx-0.5" />}
    >
      {(close) => (
        <ul className="py-1">
          {apps.map((a) => (
            <li key={a}>
              <a
                role="menuitem"
                href={`/sso?${new URLSearchParams({ app: a })}`}
                onClick={close}
                className="flex items-center px-4 py-2.5 text-label hover:bg-sunk"
              >
                {t(LABEL[a])}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
