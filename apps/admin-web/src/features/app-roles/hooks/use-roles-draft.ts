// CR-112 · ADM-FR-80, ADM-FR-82 · bản nháp của Phân quyền: thay đổi chưa lưu + MỘT lần Lưu (tạo ⇒ sửa ⇒ gán/gỡ ⇒ xoá).
// Lưu lỗi: 409 VERSION_CONFLICT hoặc đã ghi dở ⇒ tải lại và bỏ nháp (nháp không còn khớp); chưa ghi gì ⇒ giữ nháp để sửa tiếp.
import type { AppRole, AppRoleLevel } from "@ai/contracts/app-roles";
import { useMemo, useState } from "react";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { useTr } from "@/lib/use-translate";
import { roleOps, useAppRoles, useInvalidateRoles } from "../api";
import { describeRoleError, isVersionConflict } from "../lib/errors";
import {
  buildOps,
  emptyStaged,
  pendingCount,
  runOps,
  type Staged,
  setMembership,
  stageCreate,
  stageDelete,
  stageEdit,
  stageEditNew,
  undoDelete,
} from "../lib/staging";
import { buildRoleViews } from "../lib/view";

const tempId = () => `new-${Math.random().toString(36).slice(2, 10)}`;

export function useRolesDraft(tenantId: string | undefined) {
  const tr = useTr();
  const roles = useAppRoles(tenantId, true);
  const invalidate = useInvalidateRoles();
  const [staged, setStaged] = useState<Staged>(emptyStaged);
  const [saving, setSaving] = useState(false);
  const items = useMemo<AppRole[]>(() => roles.data?.items ?? [], [roles.data]);
  const views = useMemo(() => buildRoleViews(items, staged), [items, staged]);
  const update = (fn: (s: Staged) => Staged) => setStaged(fn);

  const save = async () => {
    const ops = buildOps(staged, items);
    if (ops.length === 0 || saving) return;
    setSaving(true);
    const result = await runOps(ops, roleOps(tenantId));
    await invalidate();
    setSaving(false);
    if (!result.error) {
      setStaged(emptyStaged());
      notifySuccess(tr("appRoles.toast.saved", { count: result.total }));
      return;
    }
    const spec = describeRoleError(result.error);
    notifyError(tr(spec.key, spec.params));
    if (result.applied > 0 || isVersionConflict(result.error)) setStaged(emptyStaged());
  };

  return {
    query: roles,
    items,
    views,
    staged,
    pending: pendingCount(staged),
    saving,
    save,
    discard: () => setStaged(emptyStaged()),
    create: (pack: string, name: string, level: AppRoleLevel) =>
      update((s) => stageCreate(s, { tempId: tempId(), pack, name, level })),
    edit: (ref: string, patch: { name?: string; level?: AppRoleLevel }) =>
      update((s) => {
        const base = items.find((r) => r.id === ref);
        return base ? stageEdit(s, base, patch) : stageEditNew(s, ref, patch);
      }),
    remove: (ref: string) => update((s) => stageDelete(s, ref)),
    restore: (ref: string) => update((s) => undoDelete(s, ref)),
    setMember: (ref: string, userId: string, saved: boolean, want: boolean) =>
      update((s) => setMembership(s, ref, userId, saved, want)),
  };
}

export type RolesDraft = ReturnType<typeof useRolesDraft>;
