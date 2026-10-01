// ADM-FR-33 · đổi trạng thái feature ở danh sách: Bật/Beta áp dụng ngay, Tắt qua hộp xác nhận (kill switch mức vừa).
import type { FeatureListItem } from "@ai/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { FEATURE_KEYS, type FeatureStatusFilter, fetchFeatureDetail } from "../api";
import { DisableFeatureDialog, type DisableTarget } from "../components/DisableFeatureDialog";
import { useFeaturePatch } from "./use-feature-patch";

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
  const qc = useQueryClient();
  const { patch, conflictProps } = useFeaturePatch(fail, nameOf);
  const [disable, setDisable] = useState<{ f: FeatureListItem; target: DisableTarget } | null>(
    null,
  );

  const setStatus = useCallback(
    async (f: FeatureListItem, status: FeatureStatusFilter) => {
      if (status !== "off") {
        await patch(f, status);
        return;
      }
      setDisable({ f, target: await disableTarget(qc, f, nameOf(f)) });
    },
    [patch, qc, nameOf],
  );
  const confirm = async () => {
    if (!disable) return;
    // Lỗi khác xung đột: giữ hộp thoại mở (đã báo toast); xung đột: hộp này đóng, ConflictDialog hiện.
    if ((await patch(disable.f, "off")) === "failed") throw new Error("patch failed");
  };
  const dialog = (
    <>
      <DisableFeatureDialog
        target={disable?.target ?? null}
        onClose={() => setDisable(null)}
        onConfirm={confirm}
      />
      <LazyConflictDialog props={conflictProps} />
    </>
  );
  return { setStatus, dialog };
}
