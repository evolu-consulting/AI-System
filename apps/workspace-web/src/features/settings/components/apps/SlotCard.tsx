// CR-118 §6 · CR-123 U2 (FLOW3-FR-11) · CR-125 G6 · quy trình đang áp dụng của một loại việc: CHỈ ĐỌC, đúng MỘT dòng + liên kết sang mục
// Cài đặt › Quy trình duyệt (sơ đồ ở đó). Chọn quy trình ở admin Công ty › Quy trình (nút "Mở trang Quy trình" ở `AppsPane`).
import { routingCurrent } from "@ai/web-kit/routing-current";
import { useTranslation } from "react-i18next";
import { useRouting } from "../../hooks/use-apps-settings";

export function SlotCard({
  tenantId,
  slot,
  onGoFlow,
}: {
  tenantId: string;
  slot: string;
  onGoFlow: () => void;
}) {
  const { t } = useTranslation();
  const q = useRouting(tenantId, slot);
  const a = (k: string) => t(`contracts.settings.apps.${k}`);
  const cur = q.data ? routingCurrent(q.data) : null;
  // CR-123 U2 · FLOW3-FR-11: chỉ đọc. Quy trình đang áp dụng = đúng một dòng; chọn quy trình ở admin Công ty › Quy trình.
  const applied = q.data?.processes.find((p) => p.def_id === cur?.markId) ?? null;
  return (
    <section
      data-testid={`apps-slot-${slot}`}
      className="mb-4 rounded-xl border border-rule bg-panel p-4"
      aria-label={a("slotTitle")}
    >
      <h3 className="mb-2 text-label font-semibold">{a("slotTitle")}</h3>
      {q.isError && (
        <p role="alert" className="text-late">
          {a("loadFail")}{" "}
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            {t("contracts.common.retry")}
          </button>
        </p>
      )}
      {q.isPending && <p className="text-dim">{t("contracts.common.loading")}</p>}
      {cur?.off && (
        <p data-testid="slot-off" className="text-body text-dim">
          {a("slotOff")}
        </p>
      )}
      {q.data && !applied && !cur?.off && !cur?.outside && (
        <p data-testid="slot-none-assigned" className="text-body text-dim">
          {a("noneAssigned")}
        </p>
      )}
      {cur?.outside && (
        <p data-testid="slot-in-use-outside" className="text-body">
          {t("contracts.settings.apps.current", { name: cur.outside.name })}
        </p>
      )}
      {applied && (
        <p
          data-testid={`slot-process-${applied.def_id}`}
          className="flex flex-wrap items-center gap-2"
        >
          <b className="text-label">
            {t("contracts.settings.apps.current", { name: applied.name })}
          </b>
          <button
            type="button"
            data-testid="slot-open-flow"
            className="ml-auto text-label text-act underline"
            onClick={onGoFlow}
          >
            {a("openFlow")}
          </button>
        </p>
      )}
    </section>
  );
}
