// ADM-FR-55 · M3-R20 · PATCH user kèm version, 409 → ConflictDialog (user không có updated_by → câu không {user}, A4).
// Khoá/mở khoá không nhận version nên không đi qua hook này (test-plan G5).
import type { UserUpdateRequest } from "@ai/contracts";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import type { ConflictCurrent } from "@/lib/conflict";
import { useUpdateUser } from "../api";

type Body = Omit<UserUpdateRequest, "version">;
type Handlers = {
  onSaved: () => void;
  onFail: (err: unknown) => void;
  onReload: (current: ConflictCurrent) => void;
};

export function useUserConflict(userId: string | undefined, h: Handlers) {
  const update = useUpdateUser(userId);
  const conflict = useConflictSave<Body>({
    entity: "user",
    mutate: (body) => update.mutateAsync(body as UserUpdateRequest),
    ...h,
  });
  return { ...conflict, pending: update.isPending };
}
