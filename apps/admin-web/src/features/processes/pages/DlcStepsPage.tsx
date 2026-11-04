// dlc-step-library · `/dlc-steps` (chỉ platform_admin, cùng điều kiện engine quy trình như thư viện): bảng BƯỚC DLC mẫu + thêm/sửa/
// xoá. Canvas khe `dlc.*` chèn bước từ thư viện này ("Thêm bước DLC").
import type { DlcStepTemplate } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { notifySuccess } from "@/components/shared/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/http";
import { DlcStepDialog } from "../components/library/DlcStepDialog";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { useDlcStepTemplates, useDlcStepWrite } from "../dlc-steps-api";
import { useDlcStepOptions } from "../hooks/use-dlc-step-options";
import { type DlcStepDraft, toInput } from "../lib/dlc-step-form";

type Editing = { item: DlcStepTemplate | null } | null;
const S = "process.admin.library.dlc.steps.";
const COLS = ["name", "key", "action", "agent", "gate", "reject", "rounds", "timeout"] as const;

const failKey = (e: unknown): string => {
  const code = e instanceof ApiError ? e.code : "";
  if (code === "KEY_TAKEN") return "keyTaken";
  if (code === "VERSION_CONFLICT") return "conflict";
  return code === "VALIDATION_ERROR" ? "invalid" : "generic";
};

function Row({
  s,
  onEdit,
  onRemove,
}: {
  s: DlcStepTemplate;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const action = (a: string) => t(`process.admin.library.dlc.action.${a}`, { defaultValue: a });
  const reject =
    s.gate_group === null
      ? "—"
      : s.reject_to === null || s.reject_to === "self" || s.reject_to === "prev"
        ? t(`${S}reject.${s.reject_to ?? "self"}`)
        : t(`${S}reject.action`, { action: action(s.reject_to) });
  return (
    <TableRow>
      <TableCell className="font-medium">{s.name}</TableCell>
      <TableCell className="font-mono">{s.key}</TableCell>
      <TableCell>{action(s.action)}</TableCell>
      <TableCell className="font-mono">{s.agent_key ?? t(`${S}agentDefault`)}</TableCell>
      <TableCell>
        {s.gate_group ? <Badge variant="info">{s.gate_group}</Badge> : t(`${S}gateNone`)}
      </TableCell>
      <TableCell>{reject}</TableCell>
      <TableCell>{s.max_rounds}</TableCell>
      <TableCell>{s.timeout_min}</TableCell>
      <TableCell className="space-x-2 text-right">
        <Button variant="outline" size="sm" onClick={onEdit}>
          {t(`${S}edit`)}
        </Button>
        <Button variant="outline" size="sm" onClick={onRemove}>
          {t(`${S}delete`)}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function DlcStepsContent() {
  const { t } = useTranslation();
  const list = useDlcStepTemplates(true);
  const { save, remove } = useDlcStepWrite();
  const opts = useDlcStepOptions();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<DlcStepTemplate | null>(null);
  const err = list.error instanceof ApiError ? list.error : null;
  const submit = async (d: DlcStepDraft) => {
    const cur = editing?.item;
    try {
      await save.mutateAsync({ id: cur?.id, version: cur?.version, body: toInput(d) });
    } catch (e) {
      return failKey(e);
    }
    notifySuccess(t(`${S}saved`, { name: d.name }));
    return null;
  };
  return (
    <>
      <PageHeader
        title={t(`${S}title`)}
        description={t(`${S}subtitle`)}
        actions={
          <>
            {opts.tenant.isPlatform ? (
              <TenantPicker
                tenants={opts.tenant.tenants ?? []}
                value={opts.tenant.tenantKey}
                onChange={opts.tenant.setTenant}
                label={t(`${S}agentTenant`)}
              />
            ) : null}
            <Button onClick={() => setEditing({ item: null })}>{t(`${S}create`)}</Button>
          </>
        }
      />
      {err ? (
        <ErrorState message={err.message} code={err.code} onRetry={() => void list.refetch()} />
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            {COLS.map((c) => (
              <TableHead key={c}>{t(`${S}col.${c}`)}</TableHead>
            ))}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(list.data ?? []).map((s) => (
            <Row
              key={s.id}
              s={s}
              onEdit={() => setEditing({ item: s })}
              onRemove={() => setRemoving(s)}
            />
          ))}
        </TableBody>
      </Table>
      {list.data && list.data.length === 0 ? (
        <p className="mt-4 text-label text-muted-foreground">{t(`${S}empty`)}</p>
      ) : null}
      {editing ? (
        <DlcStepDialog
          key={editing.item?.id ?? "new"}
          initial={editing.item}
          agents={opts.agents}
          groups={opts.groups}
          onClose={() => setEditing(null)}
          onSubmit={submit}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t(`${S}deleteTitle`, { name: removing.name })}
          description={t(`${S}deleteDesc`)}
          confirmLabel={t(`${S}delete`)}
          destructive
          onConfirm={async () => {
            await remove.mutateAsync(removing.id);
            notifySuccess(t(`${S}deleted`, { name: removing.name }));
          }}
        />
      ) : null}
    </>
  );
}

export function DlcStepsPage() {
  return (
    <PlatformOnly>
      <ProcessRouteGate>
        <DlcStepsContent />
      </ProcessRouteGate>
    </PlatformOnly>
  );
}
