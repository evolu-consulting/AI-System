// ADM-FR-30, ADM-FR-33 · hành động trên một feature ở danh sách: đổi trạng thái (Tắt có xác nhận), xoá (chặn khi còn command độc quyền).
import type { FeatureDetail, FeatureListItem } from "@ai/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { BlockedDialog } from "@/components/shared/BlockedDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DependencyList } from "@/components/shared/DependencyList";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import {
  FEATURE_KEYS,
  type FeatureStatusFilter,
  fetchFeatureDetail,
  useDeleteFeature,
  useUpdateFeature,
} from "../api";
import { DisableFeatureDialog, type DisableTarget } from "../components/DisableFeatureDialog";

type CommandRef = { id: string; name: string };
type Pending = { feature: FeatureListItem; commands: CommandRef[] };

/** Command chỉ thuộc đúng feature này (`feature_count = 1`): xoá feature sẽ làm chúng mồ côi. */
const exclusive = (d: FeatureDetail): CommandRef[] =>
  d.commands.filter((c) => c.feature_count === 1).map((c) => ({ id: c.id, name: c.name }));

export function useFeatureActions() {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const qc = useQueryClient();
  const update = useUpdateFeature();
  const del = useDeleteFeature();
  const [disable, setDisable] = useState<{ f: FeatureListItem; target: DisableTarget } | null>(
    null,
  );
  const [blocked, setBlocked] = useState<Pending | null>(null);
  const [toDelete, setToDelete] = useState<FeatureListItem | null>(null);
  const nameOf = useCallback(
    (f: FeatureListItem) => pickLocalized(f.name, i18n.language),
    [i18n.language],
  );

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      const reload = {
        label: t("common.reload"),
        onClick: () => void qc.invalidateQueries({ queryKey: FEATURE_KEYS.all }),
      };
      const conflict = err instanceof ApiError && err.code === "VERSION_CONFLICT";
      notifyError(tr(spec.key, spec.params), conflict ? reload : undefined);
    },
    [t, tr, qc],
  );

  const patchStatus = useCallback(
    async (f: FeatureListItem, status: FeatureStatusFilter) => {
      await update.mutateAsync({ id: f.id, version: f.version, status });
      notifySuccess(
        t("features.toast.statusChanged", {
          feature: nameOf(f),
          status: t(`features.status.${status}`),
        }),
      );
    },
    [update, t, nameOf],
  );

  const setStatus = useCallback(
    async (f: FeatureListItem, status: FeatureStatusFilter) => {
      try {
        if (status !== "off") return await patchStatus(f, status);
        const d = await qc
          .fetchQuery({
            queryKey: FEATURE_KEYS.detail(f.id),
            queryFn: () => fetchFeatureDetail(f.id),
            staleTime: 0,
          })
          .catch(() => null);
        setDisable({
          f,
          target: {
            name: nameOf(f),
            commands: f.command_count,
            users: d?.affected_user_count ?? null,
          },
        });
      } catch (err) {
        fail(err);
      }
    },
    [patchStatus, qc, nameOf, fail],
  );

  const remove = useCallback(
    async (f: FeatureListItem) => {
      try {
        const d = await qc.fetchQuery({
          queryKey: FEATURE_KEYS.detail(f.id),
          queryFn: () => fetchFeatureDetail(f.id),
          staleTime: 0,
        });
        const lonely = exclusive(d);
        if (lonely.length > 0) setBlocked({ feature: f, commands: lonely });
        else setToDelete(f);
      } catch (err) {
        fail(err);
      }
    },
    [qc, fail],
  );

  const confirmDelete = async () => {
    const f = toDelete;
    if (!f) return;
    try {
      await del.mutateAsync(f.id);
      notifySuccess(t("features.toast.deleted", { name: nameOf(f) }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "FEATURE_HAS_EXCLUSIVE_COMMANDS") {
        const list = ((err.details as { commands?: CommandRef[] } | null)?.commands ??
          []) as CommandRef[];
        setToDelete(null);
        setBlocked({ feature: f, commands: list });
        return;
      }
      fail(err);
      throw err; // giữ hộp thoại mở
    }
  };

  const dialogs = (
    <>
      <DisableFeatureDialog
        target={disable?.target ?? null}
        onClose={() => setDisable(null)}
        onConfirm={async () => {
          if (!disable) return;
          try {
            await patchStatus(disable.f, "off");
          } catch (err) {
            fail(err);
            throw err;
          }
        }}
      />
      <BlockedDialog
        open={!!blocked}
        onClose={() => setBlocked(null)}
        title={t("features.delete.blocked", { feature: blocked ? nameOf(blocked.feature) : "" })}
      >
        <DependencyList
          sections={[
            {
              title: t("common.dependency.command"),
              items: (blocked?.commands ?? []).map((c) => ({
                id: c.id,
                label: `/${c.name}`,
                mono: true,
                href: `/commands/${c.id}`,
              })),
            },
          ]}
        />
      </BlockedDialog>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("features.delete.title", { feature: toDelete ? nameOf(toDelete) : "" })}
        confirmLabel={t("features.delete.submit")}
        destructive
        level="heavy"
        confirmText={toDelete?.key}
        typePrompt={t("features.delete.typeToConfirm", { key: toDelete?.key ?? "" })}
        onConfirm={confirmDelete}
      />
    </>
  );
  return { setStatus, remove, dialogs };
}
