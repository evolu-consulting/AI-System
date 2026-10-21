// HUB-FR-72 · CR-080 · sidebar 248px: tên app "✦ Agent Forge" + menu (chỉ link thật). Dưới `lg` thay bằng nút menu ở Topbar (TD #81).
import { useTranslation } from "react-i18next";
import { SidebarNav } from "./SidebarNav";

export function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside className="hidden w-sidebar shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="flex h-topbar items-center px-4">
        <span className="text-card-title font-bold text-primary-strong">{t("app.name")}</span>
      </div>
      <SidebarNav />
    </aside>
  );
}
