// HUB-FR-66 · tab Providers: tải / rỗng / lỗi / không quyền / bảng; xoá (ConfirmDialog → InUseDialog); mở Sheet qua `?drawer=`.
// T5b gắn CheckDialog + RunbookSheet qua `onCheck`/`onGuide`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "#/components/shared/ConfirmDialog";
import { EmptyState } from "#/components/shared/EmptyState";
import { ErrorState } from "#/components/shared/ErrorState";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { useProviderMutations } from "../hooks/use-provider-mutations";
import type { ProviderItem } from "../hooks/use-providers";
import { useProviders } from "../hooks/use-providers";
import { classifySaveError } from "../lib/save-error";
import { type InUse, InUseDialog } from "./InUseDialog";
import { ProviderSheet, type ProviderTarget } from "./ProviderSheet";
import { ProviderTable } from "./ProviderTable";

type Props = {
  drawer?: string;
  onDrawer: (drawer?: string) => void;
  onCheck?: (p: ProviderItem) => void;
  onGuide?: (p: ProviderItem) => void;
};
const code = (e: unknown) => (e as { code?: unknown } | null)?.code;

function Loading() {
  return (
    <div aria-busy="true" className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function ProvidersPanel({ drawer, onDrawer, onCheck, onGuide }: Props) {
  const { t } = useTranslation();
  const q = useProviders();
  const m = useProviderMutations();
  const [toDelete, setToDelete] = useState<ProviderItem | null>(null);
  const [inUse, setInUse] = useState<InUse | null>(null);
  const items = q.data?.items ?? [];

  const hit = items.find((x) => x.id === drawer);
  const target: ProviderTarget | null =
    drawer === "new" ? { kind: "create" } : hit ? { kind: "edit", id: hit.id, key: hit.key } : null;

  const confirmDelete = async (p: ProviderItem) => {
    setToDelete(null);
    try {
      await m.remove({ id: p.id, version: p.version });
      toast.success(t("models.provider.toast.deleted", { key: p.key }));
    } catch (err) {
      m.reload();
      const refs = (err as { details?: { profiles?: InUse["refs"] } }).details?.profiles;
      if (code(err) === "PROVIDER_IN_USE" && refs) setInUse({ key: p.key, refs });
      else if (code(err) === "VERSION_CONFLICT") toast.error(t("models.errors.conflictDelete"));
      else {
        const f = classifySaveError(err);
        toast.error(t(f.message ?? f.toast?.key ?? "login.err.server", f.toast?.params));
      }
    }
  };

  if (q.error) {
    return code(q.error) === "FORBIDDEN" ? (
      <EmptyState message={t("models.state.forbidden")} />
    ) : (
      <ErrorState code={String(code(q.error) ?? "") || undefined} onRetry={() => q.refetch()} />
    );
  }
  if (q.isPending) return <Loading />;
  const add = <Button onClick={() => onDrawer("new")}>{t("models.provider.add")}</Button>;
  return (
    <div className="space-y-3">
      {items.length > 0 ? <div className="flex justify-end">{add}</div> : null}
      {items.length === 0 ? (
        <EmptyState message={t("models.state.empty.providers")} action={add} />
      ) : (
        <ProviderTable
          items={items}
          onEdit={(p) => onDrawer(p.id)}
          onDelete={setToDelete}
          onCheck={onCheck}
          onGuide={onGuide}
        />
      )}
      <ProviderSheet
        target={target}
        onClose={() => onDrawer(undefined)}
        onGuide={
          hit && onGuide
            ? () => {
                onDrawer(undefined);
                onGuide(hit);
              }
            : undefined
        }
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("models.provider.delete.title", { key: toDelete?.key ?? "" })}
        body={t("models.provider.delete.body")}
        confirmLabel={t("models.provider.delete.confirm")}
        destructive
        onConfirm={() => toDelete && void confirmDelete(toDelete)}
      />
      <InUseDialog
        value={inUse}
        titleKey="models.provider.inUse.title"
        bodyKey="models.provider.inUse.body"
        onClose={() => setInUse(null)}
      />
    </div>
  );
}
