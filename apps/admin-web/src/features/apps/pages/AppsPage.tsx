// app-catalog · /apps (chỉ platform_admin): bảng danh mục app web + thêm/sửa/xoá. Bật/tắt nhanh ngay trên bảng.
import type { AppCatalogItem, AppCreateRequest } from "@ai/contracts/app-catalog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ListEmpty, ListPage } from "@/components/shared/list/ListPage";
import { applyFilters, type FilterGroup, isFiltered } from "@/components/shared/list/list-filter";
import { rowClickProps } from "@/components/shared/list/row-click";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/http";
import { useAppList, useCreateApp, useDeleteApp, useUpdateApp } from "../api";
import { AppDrawer } from "../components/AppDrawer";
import { AppFormDialog } from "../components/AppFormDialog";

type Editing = { item: AppCatalogItem | null } | null;

function AppsContent() {
  const { t } = useTranslation();
  const list = useAppList(true);
  const create = useCreateApp();
  const update = useUpdateApp();
  const del = useDeleteApp();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<AppCatalogItem | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sel, setSel] = useState<{ status?: string; audience?: string }>({});
  const all = list.data?.items ?? [];
  const groups: FilterGroup[] = [
    {
      id: "status",
      label: t("apps.col.enabled"),
      value: sel.status,
      options: [
        { value: "on", label: t("common.on") },
        { value: "off", label: t("common.off") },
      ],
    },
    {
      id: "audience",
      label: t("apps.col.audience"),
      value: sel.audience,
      options: [...new Set(all.map((a) => a.audience))].map((v) => ({
        value: v,
        label: t(`apps.audience.${v}`),
      })),
    },
  ];
  const rows = applyFilters(all, groups, (a, id) =>
    id === "status" ? (a.enabled ? "on" : "off") : a.audience,
  );
  const opened = all.find((a) => a.key === openKey) ?? null;
  const clear = () => setSel({});
  const err = list.error instanceof ApiError ? list.error : null;

  const save = async (v: AppCreateRequest) => {
    const cur = editing?.item;
    try {
      if (cur) {
        const { key: _k, ...body } = v;
        await update.mutateAsync({ key: cur.key, body });
      } else {
        await create.mutateAsync(v);
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      return code === "KEY_TAKEN"
        ? "keyTaken"
        : code === "VALIDATION_ERROR"
          ? "invalid"
          : "generic";
    }
    notifySuccess(t("apps.toast.saved", { name: v.name.vi }));
    return null;
  };

  return (
    <ListPage
      title={t("apps.title")}
      description={t("apps.subtitle")}
      count={list.data ? all.length : undefined}
      primary={<Button onClick={() => setEditing({ item: null })}>{t("apps.create")}</Button>}
      groups={groups}
      onChange={(id, v) => setSel((s) => ({ ...s, [id]: v }))}
      onClear={clear}
      shown={list.data ? rows.length : undefined}
      total={list.data ? all.length : undefined}
    >
      {err ? (
        <ErrorState message={err.message} code={err.code} onRetry={() => void list.refetch()} />
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("apps.col.name")}</TableHead>
            <TableHead>{t("apps.col.key")}</TableHead>
            <TableHead>{t("apps.col.url")}</TableHead>
            <TableHead>{t("apps.col.audience")}</TableHead>
            <TableHead>{t("apps.col.feature")}</TableHead>
            <TableHead>{t("apps.col.sort")}</TableHead>
            <TableHead>{t("apps.col.enabled")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.key} {...rowClickProps(() => setOpenKey(a.key), openKey === a.key)}>
              <TableCell className="font-medium">{a.name.vi}</TableCell>
              <TableCell className="font-mono">{a.key}</TableCell>
              <TableCell className="max-w-64 truncate">{a.url || "—"}</TableCell>
              <TableCell>{t(`apps.audience.${a.audience}`)}</TableCell>
              <TableCell className="font-mono">{a.required_feature ?? "—"}</TableCell>
              <TableCell>{a.sort_order}</TableCell>
              <TableCell>
                <Switch
                  checked={a.enabled}
                  aria-label={`${t("apps.col.enabled")} ${a.name.vi}`}
                  onCheckedChange={(c) =>
                    void update.mutateAsync({ key: a.key, body: { enabled: c } })
                  }
                />
              </TableCell>
              <TableCell className="space-x-2 text-right">
                <Button variant="outline" size="sm" onClick={() => setEditing({ item: a })}>
                  {t("apps.edit")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRemoving(a)}>
                  {t("apps.delete")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {list.data && all.length === 0 ? (
        <p className="mt-4 text-label text-muted-foreground">{t("apps.empty")}</p>
      ) : null}
      {list.data && all.length > 0 && rows.length === 0 && isFiltered(groups) ? (
        <ListEmpty what={t("apps.what")} onClear={clear} />
      ) : null}
      <AppDrawer app={opened} onClose={() => setOpenKey(null)} />
      {editing ? (
        <AppFormDialog
          key={editing.item?.key ?? "new"}
          initial={editing.item}
          onClose={() => setEditing(null)}
          onSubmit={save}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t("apps.deleteTitle", { name: removing.name.vi })}
          description={t("apps.deleteDesc")}
          confirmLabel={t("apps.delete")}
          destructive
          onConfirm={async () => {
            await del.mutateAsync(removing.key);
            notifySuccess(t("apps.toast.deleted", { name: removing.name.vi }));
          }}
        />
      ) : null}
    </ListPage>
  );
}

export function AppsPage() {
  return (
    <PlatformOnly>
      <AppsContent />
    </PlatformOnly>
  );
}
