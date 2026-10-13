// HUB-FR-67 · D10: ghi profile → làm tươi danh sách + `me` (ConfigBadge vN).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { meQuery } from "#/features/shell/api";
import { createProfile, deleteProfile, PROFILES_KEY, updateProfile } from "../api";

export function useProfileMutations() {
  const qc = useQueryClient();
  const reload = () => {
    for (const queryKey of [PROFILES_KEY, meQuery.queryKey])
      void qc.invalidateQueries({ queryKey });
  };
  const create = useMutation({ mutationFn: createProfile });
  const update = useMutation({ mutationFn: updateProfile });
  const remove = useMutation({ mutationFn: deleteProfile });
  return {
    create: async (v: Parameters<typeof createProfile>[0]) => {
      const r = await create.mutateAsync(v);
      reload();
      return r;
    },
    update: async (v: Parameters<typeof updateProfile>[0]) => {
      const r = await update.mutateAsync(v);
      reload();
      return r;
    },
    remove: async (v: Parameters<typeof deleteProfile>[0]) => {
      await remove.mutateAsync(v);
      reload();
    },
    reload,
  };
}
