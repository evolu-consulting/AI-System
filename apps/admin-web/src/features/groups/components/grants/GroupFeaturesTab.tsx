// ADM-FR-32 · M3-R07, R08 · tab Feature của group: xem (Sửa) ↔ chế độ Sửa (Lưu · Huỷ); lưu qua MỘT batch, không đổi gì thì Lưu khoá.
import type { Group } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Button } from "@/components/ui/button";
import { useGroupGrants } from "../../hooks/use-group-grants";
import { GroupFeatureEdit } from "./GroupFeatureEdit";
import { GroupFeatureList } from "./GroupFeatureList";

export function GroupFeaturesTab({ group }: { group: Group }) {
  const { t } = useTranslation();
  const g = useGroupGrants(group);
  if (g.query.isPending) return <LoadingState />;
  if (g.query.isError) {
    const { message, code } = g.loadError;
    return <ErrorState message={message} code={code} onRetry={() => void g.query.refetch()} />;
  }
  const { draft } = g;
  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-label font-semibold">{t("groups.features.title")}</h2>
        {draft.editing ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={draft.close}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!draft.dirty || g.pending} onClick={() => void g.save()}>
              {t("common.save")}
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={draft.start}>
            {t("groups.features.edit")}
          </Button>
        )}
      </div>
      {draft.editing ? <UnsavedGuard dirty={draft.dirty} /> : null}
      {draft.editing ? (
        <GroupFeatureEdit rows={g.rows} selected={draft.selected} onToggle={draft.toggle} />
      ) : (
        <GroupFeatureList rows={g.rows} />
      )}
      <p className="text-caption text-muted-foreground">{t("groups.features.hint")}</p>
    </div>
  );
}
