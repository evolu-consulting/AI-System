// CR-118 §6 · §11.2 · Cài đặt › "Ứng dụng & quy trình" (quản trị công ty + chủ gói): mức, add-on, mỗi khe quy trình đã gán + luật chọn
// quy trình theo phòng ban (ngoại lệ DUY NHẤT cho "chỉ xem": tenant admin sửa luật, không gán/sửa nội dung quy trình).
import { useTranslation } from "react-i18next";
import { useCapabilities } from "../../hooks/use-apps-settings";
import { SlotCard } from "./SlotCard";

export default function AppsPane({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const q = useCapabilities(tenantId);
  const a = (k: string) => t(`contracts.settings.apps.${k}`);
  return (
    <div data-testid="apps-pane">
      <h2 className="mb-1 text-lg font-semibold">{a("title")}</h2>
      <p className="mb-4 text-dim">{a("lead")}</p>
      {q.isPending && <p className="text-dim">{t("contracts.common.loading")}</p>}
      {q.isError && (
        <p role="alert" className="text-late">
          {a("loadFail")}{" "}
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            {t("contracts.common.retry")}
          </button>
        </p>
      )}
      {q.data?.apps.map((app) => (
        <section key={app.key} data-testid={`apps-app-${app.key}`} className="mb-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{app.key}</h3>
            <span className="rounded-full bg-act-soft px-2.5 py-0.5 text-caption font-semibold text-act">
              {a("levelLabel")}: {a(`level.${app.level}`)}
            </span>
          </div>
          <p className="mb-3 text-caption text-dim" data-testid={`apps-addons-${app.key}`}>
            {app.addons.length === 0
              ? a("noAddons")
              : app.addons.map((o) => `${o.key}: ${a(o.on ? "addonOn" : "addonOff")}`).join(" · ")}
          </p>
          {app.slots.map((s) => (
            <SlotCard key={s.slot} tenantId={tenantId} slot={s.slot} />
          ))}
        </section>
      ))}
    </div>
  );
}
