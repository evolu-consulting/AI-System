// CR-118 §6 · CR-123 U2 (FLOW3-FR-11) · quy trình đang áp dụng của một loại việc: CHỈ ĐỌC (tên + sơ đồ nạp lười). Chọn quy trình ở
// admin Công ty › Quy trình (nút "Mở trang Quy trình" ở `AppsPane`); bộ sửa luật chọn đã gỡ khỏi ứng dụng (D6: một nơi chọn).
// Sơ đồ: `GET /tenants/:tid/process-routing/:slot/processes/:defId`.
import type { AssignedProcess } from "@ai/contracts/hub-admin";
import { routingCurrent } from "@ai/web-kit/routing-current";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouting } from "../../hooks/use-apps-settings";
import { useRoutingDef } from "../../hooks/use-routing-def";
import { FlowCanvasLazy } from "../FlowCanvasLazy";

function ProcessItem({
  tenantId,
  slot,
  p,
}: {
  tenantId: string;
  slot: string;
  p: AssignedProcess;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const diagram = useRoutingDef(tenantId, slot, p.def_id, open);
  return (
    <li data-testid={`slot-process-${p.def_id}`} className="rounded-lg border border-rule p-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-label">{t("contracts.settings.apps.current", { name: p.name })}</b>
        <button
          type="button"
          data-testid={`slot-diagram-toggle-${p.def_id}`}
          className="ml-auto text-label text-act underline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t(`contracts.settings.apps.${open ? "hideDiagram" : "viewDiagram"}`)}
        </button>
      </div>
      {open && diagram.state === "loading" && (
        <p role="status" className="mt-2 text-dim">
          {t("contracts.common.loading")}
        </p>
      )}
      {open && diagram.state === "ready" && (
        <FlowCanvasLazy steps={diagram.steps} run={diagram.steps.map(() => true)} />
      )}
      {open && diagram.state === "unavailable" && (
        <p role="alert" data-testid="slot-diagram-unavailable" className="mt-2 text-late">
          {t("contracts.settings.apps.diagramUnavailable")}
        </p>
      )}
    </li>
  );
}

export function SlotCard({ tenantId, slot }: { tenantId: string; slot: string }) {
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
        <ul className="flex flex-col gap-2">
          <ProcessItem tenantId={tenantId} slot={slot} p={applied} />
        </ul>
      )}
    </section>
  );
}
