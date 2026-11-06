// CR-118 §11.2 · trong mỗi khe của tenant (trang công ty + ngăn "Công ty" của /apps/$appKey, cùng component): tập quy trình ĐÃ GÁN
// (gán thêm / bỏ gán, bỏ gán bị chặn khi còn luật dùng ⇒ nêu luật bị ảnh hưởng) + bộ sửa luật chọn theo phòng ban. Chỉ platform_admin.
import { routingCurrent } from "@ai/web-kit/routing-current";
import type { RoutingErrorSpec } from "@ai/web-kit/routing-rules";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { useTenantDepartments, useTenantRouting } from "../../api-routing";
import { useSlotRoutingActions } from "../hooks/use-slot-routing";
import { type AssignErrorSpec, assignErrorOf } from "../lib/assign-error";
import type { SlotCandidate } from "../lib/slot-candidates";
import { AssignErrorNote } from "./AssignErrorNote";
import { RulesSection } from "./RulesSection";

const SEL =
  "h-9 min-w-0 w-full max-w-72 rounded-md border border-input bg-background px-2 text-body";

function Body({
  tenantId,
  slot,
  app,
  candidates,
}: {
  tenantId: string;
  slot: string;
  app: string;
  candidates: SlotCandidate[];
}) {
  const { t } = useTranslation();
  const k = (s: string) => t(`tenants.slots.routing.${s}`);
  const q = useTenantRouting(tenantId, slot, true);
  const depts = useTenantDepartments(tenantId, true);
  const act = useSlotRoutingActions(tenantId, slot);
  const [pick, setPick] = useState("");
  const [err, setErr] = useState<RoutingErrorSpec | null>(null);
  // Lỗi gán không thuộc nhóm ROUTING_* (nhóm, xuất bản, ứng dụng chưa dùng…) ⇒ câu nghiệp vụ + hành động khắc phục.
  const [assignErr, setAssignErr] = useState<AssignErrorSpec | null>(null);
  if (q.isError)
    return (
      <p role="alert" className="text-body text-destructive">
        {k("loadFail")}
      </p>
    );
  if (!q.data)
    return (
      <p className="text-body text-muted-foreground">
        {t("common.loading", { defaultValue: "…" })}
      </p>
    );
  const data = q.data;
  const have = new Set(data.processes.map((p) => p.def_id));
  const cur = routingCurrent(data);
  const options = candidates.filter((c) => !have.has(c.id));
  const doAssign = async () => {
    const r = await act.assign(pick);
    if (r.ok) {
      setPick("");
      setErr(null);
      setAssignErr(null);
      notifySuccess(k("assignedToast"));
    } else {
      const spec = assignErrorOf(r.raw, { app });
      setAssignErr(spec);
      setErr(spec ? null : r.spec);
    }
  };
  const doUnassign = async (defId: string) => {
    const r = await act.unassign(defId);
    setErr(r.ok ? null : r.spec);
  };
  return (
    <div className="space-y-3" data-testid={`admin-assigned-${slot}`}>
      <ul className="space-y-1">
        {data.processes.length === 0 && (
          <li className="text-body text-muted-foreground">{k("noneAssigned")}</li>
        )}
        {data.processes.map((p) => (
          <li
            key={p.def_id}
            className="flex flex-wrap items-center gap-2"
            data-testid={`admin-assigned-${p.def_id}`}
          >
            <span className="text-body">
              {p.name}
              {p.rel_version !== null ? ` · v${p.rel_version}` : ""}
            </span>
            {cur.markId === p.def_id && (
              <span
                data-testid={`admin-assigned-in-use-${p.def_id}`}
                className="rounded-full bg-primary/10 px-2 py-0.5 text-caption font-semibold text-primary"
              >
                {k("inUse")}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={act.pending}
              onClick={() => void doUnassign(p.def_id)}
            >
              {k("unassign")}
            </Button>
          </li>
        ))}
        {cur.outside && (
          <li className="text-body text-muted-foreground" data-testid="admin-in-use-outside">
            {t("tenants.slots.routing.inUseOutside", { name: cur.outside.name })}
          </li>
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={k("addPick")}
          className={SEL}
          value={pick}
          disabled={act.pending}
          onChange={(e) => setPick(e.target.value)}
          data-testid="admin-assign-pick"
        >
          <option value="">{k("addPlaceholder")}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          data-testid="admin-assign-add"
          disabled={act.pending || !pick}
          onClick={() => void doAssign()}
        >
          {k("add")}
        </Button>
      </div>
      {assignErr && <AssignErrorNote tenantId={tenantId} spec={assignErr} />}
      {err && (
        <p role="alert" data-testid="admin-assign-error" className="text-body text-destructive">
          {err.kind === "inUse"
            ? t("tenants.slots.routing.err.inUse", { rules: err.rules.join(", ") })
            : k(`err.${err.kind}`)}
        </p>
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

/** Luôn mở sẵn (không còn thu gọn): tập quy trình đã gán + "Mặc định" + luật chọn là nội dung chính của khối Quy trình. */
export function SlotRouting(p: {
  tenantId: string;
  slot: string;
  app: string;
  candidates: SlotCandidate[];
}) {
  return (
    <div data-testid={`admin-routing-details-${p.slot}`}>
      <Body {...p} />
    </div>
  );
}
