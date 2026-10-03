// ADM-FR-41 · M4-R06 · Q12 · banner quota dưới topbar, mọi trang của tenant_admin: không nút đóng, biến mất dưới 80%, lỗi tải → im lặng.
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useQuotaBanner } from "../hooks/use-quota-banner";

export function QuotaBanner() {
  const { t } = useTranslation();
  const banner = useQuotaBanner();
  if (!banner) return null;
  const over = banner.level === "over";
  return (
    <Alert
      className={cn(
        "mb-4 flex items-center gap-3 border-transparent",
        over ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning",
      )}
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      <AlertDescription className="flex-1 text-current">
        {over ? t("banner.quota100") : t("banner.quota80", { pct: banner.pct })}
      </AlertDescription>
      <Link to={"/usage" as "/"} className="text-label font-medium underline underline-offset-2">
        {t("banner.quotaLink")}
      </Link>
    </Alert>
  );
}
