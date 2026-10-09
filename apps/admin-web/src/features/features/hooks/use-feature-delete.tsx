// ADM-FR-30 · M2-R21 (CR-055) · xoá feature ở danh sách: gõ key để xoá; command chỉ thuộc feature này được liệt kê
// làm cảnh báo (sẽ thành "chưa gắn feature"), không chặn.
import type { FeatureListItem } from "@ai/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { FEATURE_KEYS, fetchFeatureDetail, useDeleteFeature } from "../api";
import { FeatureDeleteDialogs, type PendingDelete } from "../components/FeatureDeleteDialogs";
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

export function useFeatureDelete(fail: Fail, nameOf: NameOf) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const del = useDeleteFeature();
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const remove = useCallback(
    async (f: FeatureListItem) => {
      try {
        setPending({ feature: f, commands: await exclusiveOf(qc, f.id) });
      } catch (err) {
        fail(err);
      }
    },
    [qc, fail],
  );
  const confirm = async () => {
    const f = pending?.feature;
    if (!f) return;
    try {
      await del.mutateAsync(f.id);
      notifySuccess(t("features.toast.deleted", { name: nameOf(f) }));
    } catch (err) {
      fail(err);
      throw err; // giữ hộp thoại mở
    }
  };
  const dialogs = (
    <FeatureDeleteDialogs
      pending={pending}
      nameOf={nameOf}
      onClose={() => setPending(null)}
      onConfirm={confirm}
    />
  );
  return { remove, dialogs };
}
