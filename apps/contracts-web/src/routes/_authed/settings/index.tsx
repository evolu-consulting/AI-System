// PK-FR-10 · TF5 · M1D-FR-04 · route /settings/: trang Cài đặt = danh sách mục (Thành viên & phòng ban; điểm đối tác ở HD8).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

function SettingsHome() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-page-title">{t("contracts.pages.settings")}</h1>
      <ul className="flex flex-col gap-2">
        <li>
          <Link
            to="/settings/members"
            className="flex flex-col gap-0.5 rounded-lg border border-rule bg-panel px-4 py-3 hover:bg-act-soft"
          >
            <span className="font-semibold">{t("contracts.org.title")}</span>
            <span className="text-body text-dim">{t("contracts.org.entryHint")}</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}

export const Route = createFileRoute("/_authed/settings/")({
  component: SettingsHome,
});
