// HUB-FR-131 · ghi / xoá kết nối; thành công ⇒ làm mới danh sách (và `me` — ConfigBadge vN).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { meQuery } from "#/features/shell/api";
import { createKhConnection, deleteKhConnection, KH_KEY, updateKhConnection } from "../api";

export function useKhMutations() {
  const qc = useQueryClient();
  const reload = () => {
    for (const queryKey of [KH_KEY, meQuery.queryKey]) void qc.invalidateQueries({ queryKey });
  };
  const create = useMutation({ mutationFn: createKhConnection, onSuccess: reload });
  const update = useMutation({ mutationFn: updateKhConnection, onSuccess: reload });
  const remove = useMutation({ mutationFn: deleteKhConnection, onSuccess: reload });
  return {
    create: create.mutateAsync,
    update: update.mutateAsync,
    remove: remove.mutateAsync,
    reload,
  };
}
