// CR-118 §6 · §11.2 · một khe của công ty: quy trình platform đã gán (tên + phiên bản + sơ đồ chỉ đọc, nạp lười) và bộ sửa luật.
// Sơ đồ: MỌI quy trình đã gán xem được (nạp khi mở: `GET /tenants/:tid/process-routing/:slot/processes/:defId`).
import type { AssignedProcess } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDepartments, useRouting } from "../../hooks/use-apps-settings";
import { useRoutingDef } from "../../hooks/use-routing-def";
import { FlowCanvasLazy } from "../FlowCanvasLazy";
import { RoutingEditor } from "./RoutingEditor";

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
        <b className="text-label">{p.name}</b>
        <span className="text-caption text-dim">
          {p.rel_version !== null ? `v${p.rel_version}` : t("contracts.settings.apps.noVersion")}
        </span>
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
  const depts = useDepartments(true);
  const a = (k: string) => t(`contracts.settings.apps.${k}`);
  return (
    <section
      data-testid={`apps-slot-${slot}`}
      className="mb-4 rounded-xl border border-rule bg-panel p-4"
      aria-label={slot}
    >
      <h3 className="mb-2 text-label font-semibold">
        {t("contracts.settings.apps.slotTitle", { slot })}
      </h3>
      {q.isError && (
        <p role="alert" className="text-late">
          {a("loadFail")}{" "}
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            {t("contracts.common.retry")}
          </button>
        </p>
      )}
      {q.isPending && <p className="text-dim">{t("contracts.common.loading")}</p>}
      {q.data && q.data.processes.length === 0 && (
        <p data-testid="slot-none-assigned" className="text-body text-dim">
          {a("noneAssigned")}
        </p>
      )}
      {q.data && q.data.processes.length > 0 && (
        <>
          <ul className="mb-2 flex flex-col gap-2">
            {q.data.processes.map((p) => (
              <ProcessItem key={p.def_id} tenantId={tenantId} slot={slot} p={p} />
            ))}
          </ul>
          <RoutingEditor
            key={q.data.version}
            tenantId={tenantId}
            slot={slot}
            data={q.data}
            departments={depts.data ?? []}
            onReload={() => void q.refetch()}
          />
        </>
      )}
    </section>
  );
}
