// CR-112 · ADM-FR-80, ADM-FR-82 · tab Phân quyền theo vai của một công ty: callout 3 tầng, khối vai theo app, gán người, Kiểm tra quyền,
// badge "N thay đổi chưa lưu" + MỘT nút Lưu. platform_admin truyền `tenantId`; tenant_admin để trống (server suy ra từ phiên).
import type { User } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { useRolesDraft } from "../hooks/use-roles-draft";
import { sortPacks } from "../lib/levels";
import { CheckPermissionDialog } from "./CheckPermissionDialog";
import { RoleBlock } from "./RoleBlock";
import { UserAssignTable } from "./UserAssignTable";

type Props = { tenantId?: string; onDirtyChange?: (dirty: boolean) => void };

function Callout() {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/40 p-4 text-body">
      <p className="font-semibold">{t("appRoles.callout.title")}</p>
      <ol className="list-decimal space-y-0.5 pl-5">
        <li>{t("appRoles.callout.tier1")}</li>
        <li>{t("appRoles.callout.tier2")}</li>
        <li>{t("appRoles.callout.tier3")}</li>
      </ol>
      <p className="text-caption text-muted-foreground">{t("appRoles.callout.other")}</p>
    </div>
  );
}

function SaveBar({
  pending,
  saving,
  onSave,
  onDiscard,
}: {
  pending: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div role="status" className="min-w-0 flex-1 text-label text-muted-foreground">
        {pending > 0 ? t("appRoles.dirty", { count: pending }) : t("appRoles.clean")}
      </div>
      <Button variant="outline" disabled={pending === 0 || saving} onClick={onDiscard}>
        {t("appRoles.discard")}
      </Button>
      <Button disabled={pending === 0 || saving} onClick={onSave}>
        {t("common.save")}
      </Button>
    </div>
  );
}

export function RolesPanel({ tenantId, onDirtyChange }: Props) {
  const { t } = useTranslation();
  const draft = useRolesDraft(tenantId);
  const [checking, setChecking] = useState<User | null>(null);
  const dirty = draft.pending > 0;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const { query } = draft;
  const err = query.error instanceof ApiError ? query.error : null;
  if (err?.status === 403) return <ForbiddenState />;
  if (err?.status === 404) return <NotFoundState backTo="/" />;
  if (query.isPending) return <LoadingState />;
  if (query.error) {
    return (
      <ErrorState
        message={err?.message ?? ""}
        code={err?.code ?? "NETWORK_ERROR"}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const packs = sortPacks([...new Set(draft.views.map((v) => v.pack))]);
  return (
    <div className="space-y-6">
      <Callout />
      {packs.length === 0 ? <EmptyState message={t("appRoles.empty")} /> : null}
      {packs.map((pack) => (
        <RoleBlock
          key={pack}
          pack={pack}
          roles={draft.views.filter((v) => v.pack === pack)}
          onCreate={draft.create}
          onEdit={draft.edit}
          onRemove={draft.remove}
          onRestore={draft.restore}
        />
      ))}
      {packs.length > 0 ? (
        <UserAssignTable tenantId={tenantId} draft={draft} onCheck={setChecking} />
      ) : null}
      <SaveBar
        pending={draft.pending}
        saving={draft.saving}
        onSave={() => void draft.save()}
        onDiscard={draft.discard}
      />
      {checking ? (
        <CheckPermissionDialog
          user={checking}
          roles={draft.items}
          onClose={() => setChecking(null)}
        />
      ) : null}
      {onDirtyChange ? null : <UnsavedGuard dirty={dirty} />}
    </div>
  );
}

/** Mount trong tab workspace công ty (nạp lười): `<RolesTab tenant={tenant} onDirtyChange={…} />`. */
export default function RolesTab({
  tenant,
  onDirtyChange,
}: {
  tenant: { id: string };
  onDirtyChange?: (dirty: boolean) => void;
}) {
  return <RolesPanel tenantId={tenant.id} onDirtyChange={onDirtyChange} />;
}
