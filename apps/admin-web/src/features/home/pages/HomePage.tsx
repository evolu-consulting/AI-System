// ADM-NFR-06 · trang tạm M0 để kiểm toolchain; M1 thay bằng Tổng quan.
import { useTranslation } from "react-i18next";

export function HomePage() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-page">
      <img
        src="/brand/evoluconsulting-logo-horizontal.svg"
        alt={t("home.page.logoAlt")}
        width={260}
        height={80}
      />
      <h1 className="text-page-title font-bold text-foreground">{t("home.page.title")}</h1>
      <p className="text-body text-muted-foreground">{t("home.page.subtitle")}</p>
    </main>
  );
}
