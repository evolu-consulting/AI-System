// ADM-FR-62 · M3-R03 · tab Thành viên: thêm từng người (combobox), ô tìm, bảng phân trang 50, dán danh sách.
import type { Group } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { Pagination } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { useGroupMembersView } from "../../hooks/use-group-members";
import { useMemberAdd } from "../../hooks/use-member-add";
import { usePasteMembers } from "../../hooks/use-paste-members";
import { MEMBERS_PAGE_SIZE } from "../../lib/paging";
import { MemberAdder } from "./MemberAdder";
import { MemberTable } from "./MemberTable";
import { PasteMembers } from "./PasteMembers";

export function MembersTab({ group }: { group: Group }) {
  const { t } = useTranslation();
  const view = useGroupMembersView(group);
  const adder = useMemberAdd(group);
  const paste = usePasteMembers(group);
  const { list } = view;
  const taken = new Set((list.data?.items ?? []).map((m) => m.username));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <MemberAdder
          options={adder.options}
          taken={taken}
          isLoading={adder.isLoading}
          onQuery={adder.setQuery}
          onPick={adder.pick}
        />
        <div className="ml-auto w-full sm:w-auto">
          <SearchBox
            label={t("users.list.search")}
            value={view.q}
            onChange={(q) => view.patch({ q: q || undefined })}
          />
        </div>
      </div>
      <MemberTable
        members={list.data?.items}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={view.loadError}
        onRetry={() => void list.refetch()}
        empty={<EmptyState message={t("groups.members.empty")} />}
        onRemove={view.removeMember}
      />
      <Pagination
        offset={(view.page - 1) * MEMBERS_PAGE_SIZE}
        limit={MEMBERS_PAGE_SIZE}
        total={list.data?.total ?? 0}
        onOffsetChange={(o) => view.patch({ page: o / MEMBERS_PAGE_SIZE + 1 })}
      />
      <PasteMembers
        text={paste.text}
        onText={paste.setText}
        count={paste.count}
        tooMany={paste.tooMany}
        preview={paste.preview}
        checking={paste.checking}
        pending={paste.pending}
        onSubmit={() => void paste.submit()}
      />
    </div>
  );
}
