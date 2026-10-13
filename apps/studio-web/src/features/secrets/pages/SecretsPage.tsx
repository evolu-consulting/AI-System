// HUB-FR-68 · HUB-FR-69 · HUB-BR-30 · màn Secrets (ui-agent-studio §11): 3 tab theo `kind`, bảng, Sheet thêm/thay, xoá.
// Giá trị chỉ ghi, không hiện lại (D3). `?kind=` chọn tab; `?drawer=new|<id>` mở Sheet.
import { HUB_SECRET_KINDS, type HubSecret, type HubSecretKind } from "@ai/contracts/hub-admin";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "#/components/shared/ConfirmDialog";
import { EmptyState } from "#/components/shared/EmptyState";
import { ErrorState } from "#/components/shared/ErrorState";
import { PageHeader } from "#/components/shared/PageHeader";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { describeApiError } from "#/lib/api-error";
import { type InUse, InUseDialog } from "../components/InUseDialog";
import { SecretSheet, type SheetTarget } from "../components/SecretSheet";
import { SecretTable } from "../components/SecretTable";
import { useSecretMutations } from "../hooks/use-secret-mutations";
import { useSecrets } from "../hooks/use-secrets";

const route = getRouteApi("/_authed/secrets");
const apiCode = (e: unknown) => (e as { code?: unknown } | null)?.code;

function Loading() {
  return (
    <div aria-busy="true" className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function KindPanel({
  kind,
  onAdd,
  onReplace,
  onDelete,
  locale,
}: {
  kind: HubSecretKind;
  onAdd: () => void;
  onReplace: (s: HubSecret) => void;
  onDelete: (s: HubSecret) => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const q = useSecrets(kind);
  const canAdd = kind !== "source_credential";
  const add = canAdd ? <Button onClick={onAdd}>{t("secrets.create")}</Button> : null;
  if (q.error) {
    return apiCode(q.error) === "FORBIDDEN" ? (
      <EmptyState message={t("secrets.forbidden")} />
    ) : (
      <ErrorState code={String(apiCode(q.error) ?? "") || undefined} onRetry={() => q.refetch()} />
    );
  }
  if (q.isPending) return <Loading />;
  return (
    <div className="space-y-3">
      {canAdd ? (
        <div className="flex justify-end">{add}</div>
      ) : (
        <p className="text-label text-muted-foreground">{t("secrets.note.source_credential")}</p>
      )}
      {q.items.length === 0 ? (
        <EmptyState message={t(`secrets.empty.${kind}`)} action={add} />
      ) : (
        <SecretTable
          kind={kind}
          items={q.items}
          locale={locale}
          onReplace={onReplace}
          onDelete={onDelete}
        />
      )}
      {q.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={q.isFetchingNextPage}
            onClick={() => q.fetchNextPage()}
          >
            {t("secrets.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function SecretsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = route.useSearch();
  const kind: HubSecretKind = search.kind ?? "provider_api_key";
  const m = useSecretMutations();
  const list = useSecrets(kind);
  const [toDelete, setToDelete] = useState<HubSecret | null>(null);
  const [inUse, setInUse] = useState<InUse | null>(null);

  const go = (next: { kind?: HubSecretKind; drawer?: string }) =>
    void navigate({ to: "/secrets", search: next, replace: true });
  const hit = list.items.find((x) => x.id === search.drawer);
  const target: SheetTarget | null =
    search.drawer === "new" && kind !== "source_credential"
      ? { kind: "create", secretKind: kind }
      : hit
        ? { kind: "replace", item: hit }
        : null;

  const confirmDelete = async (s: HubSecret) => {
    setToDelete(null); // mọi phản hồi (204/404/409) đóng ConfirmDialog trước
    try {
      await m.remove({ id: s.id, version: s.version });
      toast.success(t("secrets.toast.deleted", { name: s.name }));
    } catch (err) {
      m.reload();
      const code = apiCode(err);
      const used = (err as { details?: { used_by?: InUse["usedBy"] } }).details?.used_by;
      if (code === "SECRET_IN_USE" && used) setInUse({ name: s.name, usedBy: used });
      else if (code === "VERSION_CONFLICT") toast.error(t("secrets.errors.conflictDelete"));
      else {
        const spec = describeApiError(err);
        toast.error(t(spec.key, spec.params));
      }
    }
  };
  const askDelete = (s: HubSecret) =>
    s.used_by.length > 0 ? setInUse({ name: s.name, usedBy: s.used_by }) : setToDelete(s);

  return (
    <>
      <PageHeader title={t("secrets.title")} subtitle={t("secrets.subtitle")} />
      <Tabs value={kind} onValueChange={(v) => go({ kind: v as HubSecretKind })}>
        <TabsList aria-label={t("secrets.tabs.aria")}>
          {HUB_SECRET_KINDS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`secrets.tab.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={kind}>
          <KindPanel
            kind={kind}
            locale={i18n.language}
            onAdd={() => go({ kind, drawer: "new" })}
            onReplace={(s) => go({ kind, drawer: s.id })}
            onDelete={askDelete}
          />
        </TabsContent>
      </Tabs>
      <SecretSheet target={target} onClose={() => go({ kind })} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("secrets.delete.title", { name: toDelete?.name ?? "" })}
        body={t("secrets.delete.body")}
        confirmLabel={t("secrets.delete.confirm")}
        destructive
        onConfirm={() => toDelete && void confirmDelete(toDelete)}
      />
      <InUseDialog value={inUse} onClose={() => setInUse(null)} />
    </>
  );
}
