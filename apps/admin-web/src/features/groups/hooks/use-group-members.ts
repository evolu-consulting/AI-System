// ADM-FR-62 · M3-R03, R05 · danh sách thành viên (phân trang server, `?q`) + bỏ khỏi group (toast có Hoàn tác 5 s).
import type { Group } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useAddMembers, useGroupMembers, useRemoveMember } from "../api";
import { MEMBERS_PAGE_SIZE } from "../lib/paging";

const route = getRouteApi("/_authed/groups/$groupId");
export const UNDO_MS = 5000;

export function useGroupMembersView(group: Group) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const search = route.useSearch();
  const setSearch = route.useNavigate();
  const page = search.page ?? 1;
  const q = search.q ?? "";
  const list = useGroupMembers(group.id, q, (page - 1) * MEMBERS_PAGE_SIZE);
  const remove = useRemoveMember(group.id);
  const add = useAddMembers(group.id);
  const groupName = pickLocalized(group.name, i18n.language);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
    const spec = describeError(err);
    notifyError(tr(spec.key, spec.params));
  };
  const removeMember = async (userId: string, username: string) => {
    try {
      await remove.mutateAsync(userId);
    } catch (err) {
      return fail(err);
    }
    const undo = {
      label: t("common.undo"),
      onClick: () => void add.mutateAsync({ usernames: [username] }).catch(fail),
    };
    notifySuccess(t("groups.toast.memberRemoved", { username, group: groupName }), undo, UNDO_MS);
  };
  const patch = (p: { q?: string; page?: number }) =>
    void setSearch({ search: (prev) => ({ ...prev, page: undefined, ...p }), replace: true });
  const e = list.error instanceof ApiError ? list.error : null;
  const loadError = e ? { message: e.message, code: e.code } : null;
  return { list, page, q, removeMember, patch, groupName, loadError };
}
