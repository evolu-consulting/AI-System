// CR-121 c11 · R4 · ngăn Gán/Đổi: chỉ liệt kê quy trình CÙNG LOẠI việc + luật định tuyến + Mặc định.
// platform_admin: SlotRouting (gán từ thư viện, bỏ gán, luật). tenant_admin: chọn trong quy trình công ty đã có (gồm bản riêng đã sao) + luật.
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import { routingCurrent } from "@ai/web-kit/routing-current";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useLibraryDefs } from "@/features/processes/library-api";
import { useFlowDepartments, useTenantRouting } from "../../api-routing";
import { useFlowAssign } from "../hooks/use-flow-assign";
import { slotCandidates } from "../lib/slot-candidates";
import { RulesSection } from "./RulesSection";
import { SlotRouting } from "./SlotRouting";

function TenantSwap({
  tenantId,
  slot,
  data,
}: {
  tenantId: string;
  slot: string;
  data: ProcessRouting;
}) {
  const { t } = useTranslation();
  const act = useFlowAssign(tenantId, slot, false);
  const depts = useFlowDepartments(tenantId, false, true);
  const cur = routingCurrent(data);
  const q = useTenantRouting(tenantId, slot, true);
  return (
    <div className="space-y-3">
      {data.processes.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("tenants.flows.tenantNoCandidates")}</p>
      ) : (
        <ul className="space-y-1">
          {data.processes.map((p) => (
            <li
              key={p.def_id}
              className="flex flex-wrap items-center gap-2"
              data-testid={`flows-candidate-${p.def_id}`}
            >
              <span className="text-body">
                {p.name}
                {p.rel_version !== null ? ` · v${p.rel_version}` : ""}
              </span>
              {cur.markId === p.def_id ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-caption font-semibold text-primary">
                  {t("tenants.flows.inUse")}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={act.pending}
                  data-testid={`flows-use-${p.def_id}`}
                  onClick={() => void act.use(p.def_id, data)}
                >
                  {t("tenants.flows.use")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <RulesSection
        key={data.version}
        tenantId={tenantId}
        slot={slot}
        data={data}
        departments={depts.data ?? []}
        onReload={() => void q.refetch()}
      />
    </div>
  );
}

export function DrawerAssign({
  tenantId,
  slot,
  jobName,
  isPlatform,
}: {
  tenantId: string;
  slot: string;
  jobName: string;
  isPlatform: boolean;
}) {
  const { t } = useTranslation();
  const lib = useLibraryDefs("library", isPlatform);
  const routing = useTenantRouting(tenantId, slot, !isPlatform);
  return (
    <section
      className="space-y-3"
      aria-label={t("tenants.flows.assignTitle")}
      data-testid={`flows-assign-panel-${slot}`}
    >
      <h3 className="text-label font-semibold">{t("tenants.flows.sameKind", { type: jobName })}</h3>
      {isPlatform ? (
        <SlotRouting
          tenantId={tenantId}
          slot={slot}
          candidates={slotCandidates(
            lib.data?.pages.flatMap((p) => p.items),
            slot,
          )}
        />
      ) : routing.data ? (
        <TenantSwap tenantId={tenantId} slot={slot} data={routing.data} />
      ) : (
        <p className="text-caption text-muted-foreground">
          {t(routing.isError ? "tenants.flows.loadFail" : "common.loading", { defaultValue: "…" })}
        </p>
      )}
    </section>
  );
}
