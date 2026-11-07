// CR-118 §6 · §11.2 · Cài đặt › "Ứng dụng & quy trình" (quản trị công ty + chủ gói): mức, add-on, quy trình đang áp dụng.
// CR-123 U2 (FLOW3-FR-11): CHỈ ĐỌC; chọn quy trình ở admin Công ty › Quy trình (nút "Mở trang Quy trình", SSO một lần).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { useCapabilities } from "../../hooks/use-apps-settings";
import { paneSlots } from "../../lib/app-slots";
import { flowEditorUrl } from "../../lib/editor-link";
import { SlotCard } from "./SlotCard";

/** CR-120 · CR-123 · một trang Quy trình duy nhất ở admin (Công ty › Quy trình): nơi DUY NHẤT chọn quy trình cho hợp đồng. */
function AllFlowsLink() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const url = await flowEditorUrl();
    setBusy(false);
    if (url) window.location.assign(url);
    else toast(t("contracts.settings.apps.allFlowsFail"), "late");
  };
  return (
    <button
      type="button"
      data-testid="apps-all-flows"
      disabled={busy}
      className="btn btn-outline mb-4"
      onClick={() => void go()}
    >
      {t("contracts.settings.apps.allFlows")}
    </button>
  );
}

export default function AppsPane({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const q = useCapabilities(tenantId);
  const a = (k: string) => t(`contracts.settings.apps.${k}`);
  return (
    <div data-testid="apps-pane">
      <h2 className="mb-1 text-lg font-semibold">{a("title")}</h2>
      <p className="mb-2 text-dim">{a("lead")}</p>
      <AllFlowsLink />
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
          {paneSlots(app.key, app.slots).map((s) => (
            <div key={s.key} data-testid={`apps-slot-row-${s.key}`}>
              {s.decl && (
                <p
                  className="mb-1 text-caption text-dim"
                  data-testid={`apps-slot-purpose-${s.key}`}
                >
                  <b className="text-label">{s.decl.label}</b> · {s.decl.purpose}
                </p>
              )}
              {s.present ? (
                <SlotCard tenantId={tenantId} slot={s.key} />
              ) : (
                <p
                  role="alert"
                  className="mb-4 text-late"
                  data-testid={`apps-slot-missing-${s.key}`}
                >
                  {a("slotMissing")}
                </p>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
