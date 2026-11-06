// CR-121 c11 · Tpl-Detail "Luật định tuyến": bảng ĐỌC (điều kiện bằng lời nghiệp vụ → quy trình, thứ tự, Mặc định cuối) + nút "Sửa luật"
// mở bộ sửa `RoutingRules` (form cũ). Dùng chung cho platform_admin và tenant_admin.
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ruleRows } from "../lib/flow-rows";
import { RoutingRules } from "./RoutingRules";

type Dept = { id: string; name: string };

export function RulesSection(p: {
  tenantId: string;
  slot: string;
  data: ProcessRouting;
  departments: readonly Dept[];
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const [edit, setEdit] = useState(false);
  const names = new Map(p.departments.map((d) => [d.id, d.name]));
  const rows = ruleRows(p.data, (id) => names.get(id) ?? "");
  const kindLabel = (k: string) =>
    t(`tenants.slots.routing.kind${k.charAt(0).toUpperCase()}${k.slice(1)}`);
  return (
    <div className="space-y-2" data-testid={`flows-rules-${p.slot}`}>
      <div className="flex items-center gap-2">
        <h4 className="text-label font-semibold">{t("tenants.flows.rulesTitle")}</h4>
        <span className="text-caption text-muted-foreground" title={t("tenants.flows.rulesInfo")}>
          {t("tenants.flows.rulesInfo")}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          aria-expanded={edit}
          data-testid={`flows-edit-rules-${p.slot}`}
          onClick={() => setEdit(!edit)}
        >
          {t(edit ? "tenants.flows.rulesDone" : "tenants.flows.rulesEdit")}
        </Button>
      </div>
      <ol className="space-y-1">
        {rows.map((r) => (
          <li
            key={`${r.order ?? "default"}`}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1 text-body"
          >
            <span className="w-5 text-caption text-muted-foreground">{r.order ?? ""}</span>
            <span className="min-w-0 flex-1">
              {r.isDefault
                ? t("tenants.flows.rulesDefault")
                : [
                    ...r.kinds.map(kindLabel),
                    ...r.depts,
                    ...(r.unknownDepts
                      ? [t("tenants.flows.rulesOtherDepts", { n: r.unknownDepts })]
                      : []),
                  ].join(" · ")}
            </span>
            <span aria-hidden>→</span>
            <span className="min-w-0 truncate font-medium">
              {r.flowName}
              {r.unavailable ? (
                <span className="ml-1 text-caption text-destructive">
                  {t(`tenants.flows.reason.${r.unavailable}`)}
                </span>
              ) : null}
            </span>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="text-caption text-muted-foreground">{t("tenants.flows.rulesNone")}</li>
        ) : null}
      </ol>
      {edit ? (
        <RoutingRules
          key={p.data.version}
          tenantId={p.tenantId}
          slot={p.slot}
          data={p.data}
          departments={p.departments}
          onReload={p.onReload}
        />
      ) : null}
    </div>
  );
}
