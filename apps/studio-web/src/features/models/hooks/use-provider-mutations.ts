// HUB-FR-66 · D10: ghi provider → làm tươi danh sách + `me` (ConfigBadge vN).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { meQuery } from "#/features/shell/api";
import { createProvider, deleteProvider, PROVIDERS_KEY, updateProvider } from "../api";

export function useProviderMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const queryKey of [PROVIDERS_KEY, meQuery.queryKey])
      void qc.invalidateQueries({ queryKey });
  };
  const create = useMutation({ mutationFn: createProvider });
  const update = useMutation({ mutationFn: updateProvider });
  const remove = useMutation({ mutationFn: deleteProvider });
  const done =
    <V, R>(m: { mutateAsync: (v: V) => Promise<R> }) =>
    async (v: V) => {
      const r = await m.mutateAsync(v);
      refresh();
      return r;
    };
  return {
    create: done(create),
    update: done(update),
    remove: done(remove),
    reload: refresh,
  };
}
