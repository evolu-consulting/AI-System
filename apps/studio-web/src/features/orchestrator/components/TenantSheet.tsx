// HUB-FR-62 · H4a-R07, R09 · Sheet thêm/sửa Orchestrator của tenant. Thêm: điền sẵn từ bản mặc định (M1), chỉ tenant bật chưa có bản riêng.
import type { Orchestrator } from "@ai/contracts/studio";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConflictDialog } from "#/components/shared/conflict/ConflictDialog";
import { Button } from "#/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { useOrchEditor } from "../hooks/use-orch-editor";
import type { SaveVars } from "../hooks/use-orch-mutations";
import { type AgentOption, fromOrch, type TenantItem } from "../lib/draft";
import { SlowAlert } from "./DefaultForm";
import { fieldProps, OrchFieldFrame, OrchFields } from "./OrchFields";

export type SheetTarget = { kind: "new" } | { kind: "edit"; orch: Orchestrator };

type Props = {
  target: SheetTarget | null;
  def: Orchestrator;
  tenants: readonly TenantItem[];
  options: AgentOption[];
  save: (v: SaveVars) => Promise<unknown>;
  reload: () => void;
  onClose: () => void;
};

type BodyProps = Omit<Props, "target"> & { target: SheetTarget };

function TenantField(p: {
  edit?: Orchestrator;
  tenants: readonly TenantItem[];
  value: string;
  error?: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const items = p.edit?.tenant
    ? [{ id: p.edit.tenant.id, label: `${p.edit.tenant.name} (${p.edit.tenant.key})` }]
    : p.tenants
        .filter((x) => x.active && !x.has_orchestrator)
        .map((x) => ({ id: x.id, label: `${x.name} (${x.key})` }));
  return (
    <OrchFieldFrame id="s-tenant" label={t("orch.sheet.tenant")} error={p.error}>
      <Select value={p.value} onValueChange={p.onChange} disabled={!!p.edit}>
        <SelectTrigger {...fieldProps("s-tenant", p.error)} className="w-full">
          <SelectValue placeholder={t("orch.sheet.pick")}>
            {items.find((i) => i.id === p.value)?.label ?? null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </OrchFieldFrame>
  );
}

function SheetBody({ target, def, tenants, options, save, reload, onClose }: BodyProps) {
  const { t } = useTranslation();
  const edit = target.kind === "edit" ? target.orch : undefined;
  const [tenantId, setTenantId] = useState(edit?.tenant?.id ?? "");
  const ed = useOrchEditor({
    source: fromOrch(edit ?? def),
    version: edit?.version ?? 1,
    tenantId: tenantId || undefined,
    create: !edit,
    save,
    reload,
    onSaved: onClose,
    agentName: (id) => options.find((o) => o.id === id)?.key ?? id,
  });
  const tenantErr = ed.errors.tenant_id;
  const slow = options.find((o) => o.id === ed.draft.agentId)?.runtime === "agentic-cli";
  const submit = () => {
    if (tenantId) void ed.submit();
    else ed.setErrors({ tenant_id: "orch.err.tenant" });
  };
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-4">
        <TenantField
          edit={edit}
          tenants={tenants}
          value={tenantId}
          error={tenantErr}
          onChange={(id) => {
            setTenantId(id);
            ed.setErrors({ ...ed.errors, tenant_id: undefined });
          }}
        />
        {slow ? <SlowAlert /> : null}
        <OrchFields idp="s" draft={ed.draft} set={ed.set} errors={ed.errors} options={options} />
      </div>
      <SheetFooter className="flex-row justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={ed.saving}>
          {t("orch.save")}
        </Button>
      </SheetFooter>
      {ed.conflict ? <ConflictDialog {...ed.conflict} /> : null}
    </form>
  );
}

export function TenantSheet({ target, ...rest }: Props) {
  const { t } = useTranslation();
  const title =
    target?.kind === "edit"
      ? t("orch.sheet.titleEdit", { tenant: target.orch.tenant?.key ?? "" })
      : t("orch.sheet.titleNew");
  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && rest.onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{t("orch.tenants.note")}</SheetDescription>
        </SheetHeader>
        {target ? (
          <SheetBody
            key={target.kind === "edit" ? target.orch.id : "new"}
            target={target}
            {...rest}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
