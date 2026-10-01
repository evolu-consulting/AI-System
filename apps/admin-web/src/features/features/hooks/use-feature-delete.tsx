// ADM-FR-30 · M2-R21 · xoá feature ở danh sách: có command độc quyền → hộp thoại chặn; không thì gõ key để xoá.
import type { FeatureListItem } from "@ai/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { ApiError } from "@/lib/http";
import { FEATURE_KEYS, fetchFeatureDetail, useDeleteFeature } from "../api";
import { FeatureDeleteDialogs, type PendingBlock } from "../components/FeatureDeleteDialogs";
import { type CommandRef, exclusive } from "../lib/exclusive";

type Fail = (err: unknown) => void;
type NameOf = (f: FeatureListItem) => string;

const exclusiveOf = async (qc: QueryClient, id: string): Promise<CommandRef[]> =>
  exclusive(
    await qc.fetchQuery({
      queryKey: FEATURE_KEYS.detail(id),
      queryFn: () => fetchFeatureDetail(id),
      staleTime: 0,
    }),
  );

/** `commands` của 409 `FEATURE_HAS_EXCLUSIVE_COMMANDS` (có command vừa gắn vào feature giữa chừng). */
const commandsOf = (err: ApiError): CommandRef[] =>
  (err.details as { commands?: CommandRef[] } | null)?.commands ?? [];

export function useFeatureDelete(fail: Fail, nameOf: NameOf) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const del = useDeleteFeature();
  const [blocked, setBlocked] = useState<PendingBlock | null>(null);
  const [toDelete, setToDelete] = useState<FeatureListItem | null>(null);

  const remove = useCallback(
    async (f: FeatureListItem) => {
      try {
        const lonely = await exclusiveOf(qc, f.id);
        if (lonely.length > 0) setBlocked({ feature: f, commands: lonely });
        else setToDelete(f);
      } catch (err) {
        fail(err);
      }
    },
    [qc, fail],
  );
  const confirm = async () => {
    const f = toDelete;
    if (!f) return;
    try {
      await del.mutateAsync(f.id);
      notifySuccess(t("features.toast.deleted", { name: nameOf(f) }));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "FEATURE_HAS_EXCLUSIVE_COMMANDS")) {
        fail(err);
        throw err; // giữ hộp thoại mở
      }
      setToDelete(null);
      setBlocked({ feature: f, commands: commandsOf(err) });
    }
  };
  const dialogs = (
    <FeatureDeleteDialogs
      blocked={blocked}
      toDelete={toDelete}
      nameOf={nameOf}
      onCloseBlocked={() => setBlocked(null)}
      onCloseDelete={() => setToDelete(null)}
      onConfirm={confirm}
    />
  );
  return { remove, dialogs };
}
