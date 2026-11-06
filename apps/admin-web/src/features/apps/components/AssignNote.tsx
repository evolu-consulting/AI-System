// CR-121 c13 · R7 · trang app KHÔNG còn điều khiển gán quy trình: chỉ link sang Công ty › Quy trình của từng công ty đang dùng app.
// Từ URL cũ `?tab=processes|companies` ⇒ nhấn mạnh thông báo "Gán quy trình ở trang Công ty".
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { CompanyRow } from "../lib/app-config";

const MAX_LINKS = 12;

export function AssignNote({
  rows,
  highlight,
}: {
  rows: readonly CompanyRow[];
  highlight: boolean;
}) {
  const { t } = useTranslation();
  const on = rows.filter((r) => r.level !== "off");
  return (
    <section
      role={highlight ? "status" : undefined}
      aria-label={t("appcfg.assignNote.title")}
      data-testid="app-assign-note"
      className={`mb-4 space-y-2 rounded-md border p-3 ${highlight ? "border-primary bg-primary/5" : "border-border"}`}
    >
      <p className="text-label font-semibold">{t("appcfg.assignNote.title")}</p>
      <p className="text-caption text-muted-foreground">{t("appcfg.assignNote.body")}</p>
      {on.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {on.slice(0, MAX_LINKS).map((r) => (
            <li key={r.id}>
              <Link
                to="/tenants/$tenantId"
                params={{ tenantId: r.id }}
                search={{ tab: "processes" }}
                className="text-body underline-offset-4 hover:underline"
                data-testid={`app-flows-link-${r.key}`}
              >
                {t("appcfg.assignNote.open", { company: r.name })}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Link to="/tenants" className="text-body underline-offset-4 hover:underline">
          {t("appcfg.assignNote.pickCompany")}
        </Link>
      )}
    </section>
  );
}
