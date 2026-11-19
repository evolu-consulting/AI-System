// CR-189 BR-189-4/5 · ô của bảng Thành viên: tên (avatar + họ tên + chức vụ) và cấp quản lý (chỉ trưởng phòng, gợi ý, cảnh báo vàng).
import type { OrgMemberRow, OrgResponse } from "@ai/contracts/org";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { TruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { useTranslation } from "react-i18next";
import { PersonPick } from "~/shared/ui/PersonPick";
import { headCandidates, managerNotHead, suggestedHeadOf } from "../lib/org";

export function NameCell({ m, src }: { m: OrgMemberRow; src?: string | null | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PersonAvatar name={m.display_name} id={m.user_id} src={src} size={32} interactive={false} />
      <span className="min-w-0">
        <TruncText text={m.display_name} className="block font-medium" />
        <TruncText text={m.job_title || m.username} className="block text-sm text-dim" />
      </span>
    </span>
  );
}

export function ManagerCell({
  m,
  org,
  pending,
  onSet,
}: {
  m: OrgMemberRow;
  org: OrgResponse | undefined;
  pending: boolean;
  onSet: (managerId: string | null) => void;
}) {
  const { t } = useTranslation();
  const sug = org ? suggestedHeadOf(org.departments, m.user_id) : null;
  const sugName = sug ? org?.members.find((x) => x.user_id === sug)?.display_name : undefined;
  return (
    <div className="flex flex-col items-start gap-1">
      <PersonPick
        source={`org-heads:${m.user_id}`}
        fetchPage={async (q) => ({
          items: org ? headCandidates(org, m.user_id, q) : [],
          next: null,
        })}
        value={m.manager_id ?? ""}
        valueName={m.manager_name ?? undefined}
        clearable
        placeholder={t("contracts.org.managerPlaceholder")}
        ariaLabel={`${t("contracts.org.manager")} · ${m.display_name}`}
        onChange={(id) => onSet(id || null)}
      />
      {org && m.manager_id && managerNotHead(org, m.manager_id) && (
        <span
          data-testid="manager-not-head"
          className="rounded-md bg-warning-bg px-2 py-0.5 text-caption font-semibold text-warning"
        >
          {t("contracts.org.notHead")}
        </span>
      )}
      {sug && sugName && !m.manager_id && (
        <button
          type="button"
          data-testid="manager-suggest"
          disabled={pending}
          className="text-caption text-act underline"
          onClick={() => onSet(sug)}
        >
          {t("contracts.org.suggest", { name: sugName })}
        </button>
      )}
    </div>
  );
}
