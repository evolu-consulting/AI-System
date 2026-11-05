// hub-routing-backfill · `/processes` tab "Của công ty" · mục CHỈ ĐỌC "Được platform gán": mỗi khe của tenant, quy trình
// platform đã gán (tên + phiên bản + "Đang dùng") và xem sơ đồ (nạp khi mở, qua GET routing …/processes/:defId — tenant_admin
// không đọc được def thư viện trực tiếp). Gán/sửa: chỉ platform; luật chọn quy trình: Cài đặt. Nạp lười từ ProcessesPage.
import type { TenantCapabilitiesResponse } from "@ai/contracts";
import type { ProcessRoutingDefView } from "@ai/contracts/hub-admin";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlowRowsView } from "@/features/apps/components/SlotFlowView";
import { rowsFromSlotBody } from "@/features/apps/lib/flow-view";
import { useTenantRouting } from "@/features/tenants/api-routing";
import { api } from "@/lib/http";
import { hubUrl } from "@/lib/hub";
import { type AssignedRow, assignedView, slotsOfCaps } from "../../lib/assigned-view";

const enc = encodeURIComponent;
const hub = (path: string) => hubUrl(path) ?? "";
const k = (s: string) => `process.admin.assigned.${s}`;

function Diagram({ tid, slot, defId }: { tid: string; slot: string; defId: string }) {
  const q = useQuery({
    queryKey: ["process", "routing", tid, slot, "def", defId],
    retry: false,
    queryFn: () =>
      api<ProcessRoutingDefView>(
        hub(`/tenants/${enc(tid)}/process-routing/${enc(slot)}/processes/${enc(defId)}`),
      ),
  });
  const rows = useMemo(() => (q.data ? rowsFromSlotBody(q.data.slot_body) : null), [q.data]);
  return <FlowRowsView rows={rows} pending={q.isPending} error={q.error} />;
}

function Row({ tid, slot, r }: { tid: string; slot: string; r: AssignedRow }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li
      className="space-y-2 rounded-md border border-border p-3"
      data-testid={`assigned-row-${r.defId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-label">{r.name}</b>
        <span className="text-caption text-muted-foreground">
          {r.version !== null ? `v${r.version}` : t(k("unpublished"))}
        </span>
        {r.inUse && (
          <span
            data-testid={`assigned-in-use-${r.defId}`}
            className="rounded-full bg-primary/10 px-2 py-0.5 text-caption font-semibold text-primary"
          >
            {t(k("inUse"))}
          </span>
        )}
        <button
          type="button"
          className="ml-auto text-label text-primary underline"
          aria-expanded={open}
          data-testid={`assigned-diagram-${r.defId}`}
          onClick={() => setOpen(!open)}
        >
          {t(k(open ? "hideDiagram" : "viewDiagram"))}
        </button>
      </div>
      {open && <Diagram tid={tid} slot={slot} defId={r.defId} />}
    </li>
  );
}

function SlotBlock({ tid, slot }: { tid: string; slot: string }) {
  const { t } = useTranslation();
  const q = useTenantRouting(tid, slot, true);
  const v = q.data ? assignedView(q.data) : null;
  return (
    <section className="space-y-2" data-testid={`assigned-slot-${slot}`}>
      <h3 className="text-label font-semibold">{t(k("slot"), { slot })}</h3>
      {q.isError && <p className="text-body text-destructive">{t(k("loadFail"))}</p>}
      {v && v.rows.length === 0 && !v.outside && (
        <p className="text-body text-muted-foreground">{t(k("none"))}</p>
      )}
      {v?.outside && (
        <p className="text-body text-muted-foreground" data-testid="assigned-in-use-outside">
          {t(k("inUseOutside"), { name: v.outside.name })}
        </p>
      )}
      {v && v.rows.length > 0 && (
        <ul className="space-y-2">
          {v.rows.map((r) => (
            <Row key={r.defId} tid={tid} slot={slot} r={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AssignedProcesses({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const caps = useQuery({
    queryKey: ["process", "assigned", "caps", tenantId],
    retry: false,
    queryFn: () =>
      api<TenantCapabilitiesResponse>(hub(`/hub-admin/tenants/${enc(tenantId)}/capabilities`)),
  });
  const slots = caps.data ? slotsOfCaps(caps.data) : [];
  return (
    <div className="space-y-3 rounded-md border border-border p-4" data-testid="assigned-processes">
      <div>
        <h2 className="text-base font-semibold">{t(k("title"))}</h2>
        <p className="text-caption text-muted-foreground">{t(k("lead"))}</p>
      </div>
      {caps.isPending && <p className="text-body text-muted-foreground">{t(k("loading"))}</p>}
      {caps.isError && <p className="text-body text-destructive">{t(k("loadFail"))}</p>}
      {caps.data && slots.length === 0 && (
        <p className="text-body text-muted-foreground">{t(k("none"))}</p>
      )}
      {slots.map((s) => (
        <SlotBlock key={s} tid={tenantId} slot={s} />
      ))}
    </div>
  );
}
