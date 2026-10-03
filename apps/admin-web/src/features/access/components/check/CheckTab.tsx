// ADM-FR-36 · M3-R12, R13 · tab Kiểm tra quyền (F4): chọn người dùng, tìm command, AccessExplainer + hành động gợi ý.
import type { FeatureMini } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessExplainer } from "@/components/shared/access/AccessExplainer";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { SearchCombobox } from "@/components/shared/SearchCombobox";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { useAccessCheck } from "../../hooks/use-access-check";
import { useAddBeta } from "../../hooks/use-add-beta";
import { useUserPicker } from "../../hooks/use-user-picker";
import { GrantToGroupDialog } from "./GrantToGroupDialog";

type Props = {
  tenantId: string | undefined;
  isPlatform: boolean;
  username: string | undefined;
  onUser: (username: string | undefined) => void;
};

export function CheckTab({ tenantId, isPlatform, username, onUser }: Props) {
  const { t, i18n } = useTranslation();
  const picker = useUserPicker(tenantId, true);
  const check = useAccessCheck({ tenantId, username, enabled: true });
  const addBeta = useAddBeta(check.data?.user.tenant_id, check.data?.user.username);
  const [query, setQuery] = useState("");
  const [granting, setGranting] = useState<FeatureMini | null>(null);
  const data = check.data;

  return (
    <div className="space-y-4">
      <p className="text-body text-muted-foreground">{t("access.check.subtitle")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <SearchCombobox
          label={t("access.check.user")}
          placeholder={t("access.check.userPlaceholder")}
          options={picker.options}
          isLoading={picker.isLoading}
          onQuery={picker.setQuery}
          onPick={onUser}
        />
        {username ? <span className="font-mono text-label">{username}</span> : null}
        {data ? (
          <SearchBox label={t("access.check.search")} value={query} onChange={setQuery} />
        ) : null}
      </div>
      {!username ? <EmptyState message={t("access.check.prompt")} /> : null}
      {check.isLoading ? <LoadingState /> : null}
      {check.notFound ? <EmptyState message={t("access.check.userNotFound")} /> : null}
      {check.loadError ? <ErrorState {...check.loadError} onRetry={check.retry} /> : null}
      {data ? (
        <AccessExplainer
          data={data}
          query={query}
          lang={i18n.language}
          actions={{
            isPlatform,
            username: data.user.username,
            onGrant: setGranting,
            onAddBeta: () => void addBeta.run(),
            addBetaDisabled: !addBeta.ready,
          }}
        />
      ) : null}
      {granting && data ? (
        <GrantToGroupDialog
          tenantId={data.user.tenant_id}
          feature={granting}
          userGroupIds={data.user.groups.map((g) => g.id)}
          onClose={() => setGranting(null)}
        />
      ) : null}
    </div>
  );
}
