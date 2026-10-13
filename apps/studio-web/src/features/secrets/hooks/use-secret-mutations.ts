// HUB-FR-68 · HUB-BR-30 · D4: ghi secret. Giá trị chỉ nằm trong `variables` của mutation → `gcTime: 0` + `reset()` ngay khi settle
// (cả thành công lẫn lỗi) để cache mutation không giữ `value`. Thành công → invalidate danh sách + `me` (ConfigBadge vN).
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { meQuery } from "#/features/shell/api";
import { createSecret, deleteSecret, rotateSecret, SECRETS_KEY } from "../api";

export const secretMutationOptions = { gcTime: 0 } as const;

export const refreshSecrets = (qc: QueryClient) => {
  for (const queryKey of [SECRETS_KEY, meQuery.queryKey]) void qc.invalidateQueries({ queryKey });
};

type Guarded<V, R> = { mutateAsync: (v: V) => Promise<R>; reset: () => void };

/** Chạy mutation, `reset()` trong `finally` (kể cả khi lỗi). Giá trị cho [Ghi đè] lấy lại từ state form, không từ cache. */
export async function runGuarded<V, R>(m: Guarded<V, R>, v: V, onOk?: () => void): Promise<R> {
  try {
    const r = await m.mutateAsync(v);
    onOk?.();
    return r;
  } finally {
    m.reset();
  }
}

export function useSecretMutations() {
  const qc = useQueryClient();
  const create = useMutation({ mutationFn: createSecret, ...secretMutationOptions });
  const rotate = useMutation({ mutationFn: rotateSecret, ...secretMutationOptions });
  const remove = useMutation({ mutationFn: deleteSecret, ...secretMutationOptions });
  const ok = () => refreshSecrets(qc);
  return {
    create: (v: Parameters<typeof createSecret>[0]) => runGuarded(create, v, ok),
    rotate: (v: Parameters<typeof rotateSecret>[0]) => runGuarded(rotate, v, ok),
    remove: (v: Parameters<typeof deleteSecret>[0]) => runGuarded(remove, v, ok),
    reload: ok,
  };
}
