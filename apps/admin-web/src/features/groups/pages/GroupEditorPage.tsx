// ADM-FR-62 · ADM-FR-55 · /groups/$groupId (mẫu B): đầu trang (Đổi tên, Xoá), 3 tab Thành viên · Feature · Agent.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { ApiError } from "@/lib/http";
import { useGroup } from "../api";
import { GroupHeader } from "../components/editor/GroupHeader";
import { GroupRenameDialog } from "../components/editor/GroupRenameDialog";
import { GroupTabs } from "../components/editor/GroupTabs";
import { GroupFeaturesTab } from "../components/grants/GroupFeaturesTab";
import { MembersTab } from "../components/members/MembersTab";
import { useGroupDelete } from "../hooks/use-group-delete";

const route = getRouteApi("/_authed/groups/$groupId");

export function GroupEditorPage() {
  const { groupId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate();
  const setSearch = route.useNavigate();
  const query = useGroup(groupId);
  const [renaming, setRenaming] = useState(false);
  const del = useGroupDelete(() => void navigate({ to: "/groups", search: {} }));

  if (query.isPending) return <LoadingState />;
  if (query.isError) {
    const e = query.error instanceof ApiError ? query.error : null;
    if (e?.status === 404) return <NotFoundState backTo="/groups" />;
    return (
      <ErrorState
        message={e?.message ?? ""}
        code={e?.code ?? "HTTP_ERROR"}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const group = query.data;
  return (
    <>
      <GroupHeader
        group={group}
        onRename={() => setRenaming(true)}
        onDelete={() => del.remove(group)}
      />
      <GroupTabs
        tab={search.tab ?? "members"}
        onTab={(tab) => void setSearch({ search: (prev) => ({ ...prev, tab }), replace: true })}
        members={<MembersTab group={group} />}
        features={<GroupFeaturesTab group={group} />}
      />
      {renaming ? (
        <GroupRenameDialog
          group={group}
          open
          onClose={() => setRenaming(false)}
          onReload={() => void query.refetch()}
        />
      ) : null}
      {del.dialog}
    </>
  );
}
