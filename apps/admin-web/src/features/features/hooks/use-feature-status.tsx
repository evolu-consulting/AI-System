// ADM-FR-33 · đổi trạng thái feature ở danh sách: Bật/Beta áp dụng ngay, Tắt qua hộp xác nhận (kill switch mức vừa).
import type { FeatureListItem } from "@ai/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import {
  FEATURE_KEYS,
  type FeatureStatusFilter,
  fetchFeatureDetail,
  useUpdateFeature,
} from "../api";
import { DisableFeatureDialog, type DisableTarget } from "../components/DisableFeatureDialog";

type Fail = (err: unknown) => void;
type NameOf = (f: FeatureListItem) => string;

/** Nạp `affected_user_count` mới cho hộp thoại Tắt; lỗi nạp → câu không có số (`users: null`). */
async function disableTarget(
  qc: QueryClient,
  f: FeatureListItem,
  name: string,
): Promise<DisableTarget> {
  const d = await qc
    .fetchQuery({
      queryKey: FEATURE_KEYS.detail(f.id),
      queryFn: () => fetchFeatureDetail(f.id),
      staleTime: 0,
    })
    .catch(() => null);
  return { name, commands: f.command_count, users: d?.affected_user_count ?? null };
}

export function useFeatureStatus(fail: Fail, nameOf: NameOf) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const update = useUpdateFeature();
  const [disable, setDisable] = useState<{ f: FeatureListItem; target: DisableTarget } | null>(
    null,
  );

  const patch = useCallback(
    async (f: FeatureListItem, status: FeatureStatusFilter) => {
      await update.mutateAsync({ id: f.id, version: f.version, status });
      const label = t(`features.status.${status}`);
      notifySuccess(t("features.toast.statusChanged", { feature: nameOf(f), status: label }));
    },
    [update, t, nameOf],
  );
  const setStatus = useCallback(
    async (f: FeatureListItem, status: FeatureStatusFilter) => {
      try {
        if (status !== "off") return await patch(f, status);
        setDisable({ f, target: await disableTarget(qc, f, nameOf(f)) });
      } catch (err) {
        fail(err);
      }
    },
    [patch, qc, nameOf, fail],
  );
  const confirm = async () => {
    if (!disable) return;
    await patch(disable.f, "off").catch((err) => {
      fail(err);
      throw err; // giữ hộp thoại mở
    });
  };
  const dialog = (
    <DisableFeatureDialog
      target={disable?.target ?? null}
      onClose={() => setDisable(null)}
      onConfirm={confirm}
    />
  );
  return { setStatus, dialog };
}
