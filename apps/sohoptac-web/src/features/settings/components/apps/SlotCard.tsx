// CR-118 §6 · §11.2 · một khe của công ty: quy trình platform đã gán (tên + phiên bản + sơ đồ chỉ đọc, nạp lười) và bộ sửa luật.
// Sơ đồ: hub chỉ có đường đọc định nghĩa cho quy trình ĐANG DÙNG (`/pack/contracts/approval-flow`) ⇒ các quy trình còn lại chỉ hiện tên.
import type { AssignedProcess } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDepartments, useRouting } from "../../hooks/use-apps-settings";
import { useFlow } from "../../hooks/use-flow";
import { FlowCanvasLazy } from "../FlowCanvasLazy";
import { RoutingEditor } from "./RoutingEditor";

function ProcessItem({ p, current }: { p: AssignedProcess; current: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const flow = useFlow(open && current);
  return (
    <li data-testid={`slot-process-${p.def_id}`} className="rounded-lg border border-rule p-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-label">{p.name}</b>
        <span className="text-caption text-dim">
          {p.rel_version !== null ? `v${p.rel_version}` : t("contracts.settings.apps.noVersion")}
        </span>
        {current ? (
          <button
            type="button"
            className="ml-auto text-label text-act underline"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {t(`contracts.settings.apps.${open ? "hideDiagram" : "viewDiagram"}`)}
          </button>
        ) : (
          <span className="ml-auto text-caption text-dim">
            {t("contracts.settings.apps.diagramCurrentOnly")}
          </span>
        )}
      </div>
      {open && flow.data && (
        <FlowCanvasLazy steps={flow.data.steps} run={flow.data.steps.map(() => true)} />
      )}
      {open && flow.isError && (
        <p role="alert" className="mt-2 text-late">
          {t("contracts.flow.loadFail")}
        </p>
      )}
    </li>
  );
}

export function SlotCard({ tenantId, slot }: { tenantId: string; slot: string }) {
  const { t } = useTranslation();
  const q = useRouting(tenantId, slot);
  const depts = useDepartments(true);
  const flow = useFlow(true);
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
              <ProcessItem key={p.def_id} p={p} current={flow.data?.defId === p.def_id} />
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
