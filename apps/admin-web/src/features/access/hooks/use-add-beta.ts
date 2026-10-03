// ADM-FR-34 · M3-R11 · "Thêm {user} vào beta-testers": POST members vào group `is_beta` của tenant rồi làm mới quyền hiệu lực.
import { useQueryClient } from "@tanstack/react-query";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { useAddMembers, useGroupOptions } from "@/features/groups/api";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { ACCESS_KEYS } from "../api";

export function useAddBeta(tenantId: string | undefined, username: string | undefined) {
  const tr = useTr();
  const qc = useQueryClient();
  const groups = useGroupOptions(tenantId, !!tenantId);
  const beta = groups.data?.find((g) => g.is_beta);
  const add = useAddMembers(beta?.id ?? "");
  const run = async () => {
    if (!beta || !username) return;
    try {
      const res = await add.mutateAsync({ usernames: [username] });
      await qc.invalidateQueries({ queryKey: ACCESS_KEYS.all });
      if (res.not_found.length > 0)
        notifyError(tr("access.check.betaNotFound", { user: username }));
      else notifySuccess(tr("access.check.betaAdded", { user: username }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
    }
  };
  // `ready` = đã biết group beta-testers của tenant (chưa có thì khoá nút); `pending` = đang gửi.
  return { run, ready: !!beta && !add.isPending };
}
