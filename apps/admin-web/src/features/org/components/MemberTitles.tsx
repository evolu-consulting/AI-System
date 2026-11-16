// CR-147b ý 9 · «Chức vụ nhân viên» ở Cơ cấu: quản trị công ty nhập chức vụ của từng thành viên (hiện ở hồ sơ cá nhân + thẻ người).
import type { OrgMember } from "@ai/contracts/org";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  members: readonly OrgMember[];
  busy: boolean;
  act: (fn: () => Promise<unknown>) => void;
  save: (userId: string, title: string | null) => Promise<unknown>;
};

export function MemberTitles({ members, busy, act, save }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <section className="space-y-2" data-testid="org-titles">
      <h3 className="text-sm font-medium">{t("orgEdit.titlesHeading")}</h3>
      <ul className="space-y-1">
        {members.map((m) => {
          const cur = draft[m.user_id] ?? m.job_title ?? "";
          const dirty = cur.trim() !== (m.job_title ?? "");
          return (
            <li key={m.user_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-56 truncate">{m.display_name}</span>
              <Input
                aria-label={`${t("orgEdit.titleLabel")} · ${m.display_name}`}
                data-testid={`org-title-${m.user_id}`}
                value={cur}
                maxLength={80}
                placeholder={t("orgEdit.titlePlaceholder")}
                onChange={(e) => setDraft({ ...draft, [m.user_id]: e.target.value })}
                className="h-8 w-64"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !dirty}
                data-testid={`org-title-save-${m.user_id}`}
                onClick={() => act(() => save(m.user_id, cur.trim() || null))}
              >
                {t("orgEdit.titleSave")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
