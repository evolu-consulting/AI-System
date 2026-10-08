// CR-052 phương án C · cửa sổ Evolu Control mẫu (tĩnh, trang trí): sidebar + Overview với 3 KPI (thanh xám, KHÔNG số),
// hạn mức tháng 62% và "Thay đổi gần đây". Tên Ledger/acme chỉ là minh hoạ.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const NAV = ["overview", "companies", "users", "groups", "commands", "usage", "audit"] as const;
const KPIS = [
  { key: "companies", width: "w-[40%]" },
  { key: "users", width: "w-[55%]" },
  { key: "runs", width: "w-[65%]" },
] as const;
const CHANGES = [1, 2, 3] as const;

function Kpi({ k, width }: { k: string; width: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3.5">
      <span className="text-caption text-muted-foreground">
        {t(`auth.login.showcase.kpi.${k}`)}
      </span>
      <span className={cn("h-3.5 rounded bg-chart-4/60", width)} />
    </div>
  );
}

export function ShowcaseWindow() {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex w-[200px] flex-col gap-1 border-r border-border bg-sidebar px-3 py-4 text-label">
        {NAV.map((k, i) => (
          <span
            key={k}
            className={cn(
              "rounded-md p-2",
              i === 0
                ? "bg-accent font-semibold text-accent-foreground"
                : "text-secondary-foreground",
            )}
          >
            {t(`auth.login.showcase.nav.${k}`)}
          </span>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-4 px-6 py-5">
        <span className="text-card-title font-semibold">
          {t("auth.login.showcase.nav.overview")}
        </span>
        <div className="grid grid-cols-3 gap-3">
          {KPIS.map((k) => (
            <Kpi key={k.key} k={k.key} width={k.width} />
          ))}
        </div>
        <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-3.5 text-label">
          <div className="flex justify-between">
            <b>{t("auth.login.showcase.quota")}</b>
            <span className="text-muted-foreground">{t("auth.login.showcase.quotaTenant")}</span>
          </div>
          <div className="h-2 rounded-full bg-accent">
            <div className="h-2 w-[62%] rounded-full bg-primary" />
          </div>
        </div>
        <div className="flex flex-col rounded-xl border border-border px-4 py-1 text-label">
          <b className="pt-2.5 pb-1.5">{t("auth.login.showcase.recent")}</b>
          {CHANGES.map((n) => (
            <div key={n} className="flex items-center gap-2.5 border-t border-row-divider py-[9px]">
              <span
                className={cn("size-2 rounded-full", n === 1 ? "bg-primary" : "bg-on-ink-link")}
              />
              {t(`auth.login.showcase.change${n}`)}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
