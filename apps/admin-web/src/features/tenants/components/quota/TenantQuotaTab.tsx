// ADM-FR-40 · M4-AC02 · Q9 · tab Quota của tenant: bảng Cả tenant + từng feature, ô số (trống = Không giới hạn), thanh lưu dính đáy.
// Info và Quota dùng chung `version` tenant (D7): `tenant.version` luôn là bản mới nhất, lưu tab nào cũng cập nhật cache chung.
import type { TenantDetail } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { useOnline } from "@/components/shared/ConnectionBanner";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pickLocalized } from "@/lib/localized";
import { useQuotaTab } from "../../hooks/use-quota-tab";
import { QUOTA_FIELDS, type QuotaField } from "../../lib/quota-draft";
import { AddQuotaFeature } from "./AddQuotaFeature";
import { QuotaRowView } from "./QuotaRowView";

type Props = {
  tenant: TenantDetail;
  onDirtyChange: (dirty: boolean) => void;
  /** Sau "Tải bản mới" ở hộp xung đột: nạp lại tenant (version mới nhất). */
  onReloadTenant: () => void;
};

const monthLabel = (month: string) => month.split("-").reverse().join("/");

function SaveBar({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <div className="fixed right-0 bottom-0 left-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-drawer lg:left-sidebar">
      <span className="text-label text-muted-foreground">{t("common.unsaved")}</span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={saving || !online}
          title={online ? undefined : t("state.offline.saveTip")}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

export function TenantQuotaTab(props: Props) {
  const { t, i18n } = useTranslation();
  const q = useQuotaTab(props);
  if (q.pending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (q.failed) {
    return <ErrorState message={q.failed.message} code={q.failed.code} onRetry={q.refetch} />;
  }
  const set = (i: number, f: QuotaField, v: string) =>
    q.setDraft((d) => d.map((r, j) => (j === i ? { ...r, [f]: v } : r)));

  return (
    <>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          q.submit();
        }}
        className="space-y-4 pb-20"
      >
        <div>
          <h2 className="text-h3 font-semibold">
            {t("tenants.quota.title", { month: monthLabel(q.month) })}
          </h2>
          <p className="text-caption text-muted-foreground">{t("tenants.quota.hint")}</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("tenants.quota.col.scope")}</TableHead>
              {QUOTA_FIELDS.map((f) => (
                <TableHead key={f}>{t(`tenants.quota.col.${f}`)}</TableHead>
              ))}
              <TableHead>{t("tenants.quota.col.used")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.draft.map((r, i) => (
              <QuotaRowView
                key={r.feature_id ?? "tenant"}
                row={r}
                rowIndex={i}
                status={q.statuses.find((s) => s.feature_id === r.feature_id)}
                touched={q.touched}
                onChange={(f, v) => set(i, f, v)}
                onBlur={() => q.setTouched(true)}
                onRemove={
                  r.feature_id ? () => q.setDraft((d) => d.filter((_, j) => j !== i)) : undefined
                }
              />
            ))}
          </TableBody>
        </Table>
        <AddQuotaFeature
          options={q.options.data}
          loading={q.options.isPending}
          taken={q.draft.flatMap((r) => (r.feature_id ? [r.feature_id] : []))}
          onPick={(o) =>
            q.setDraft((d) => [
              ...d,
              {
                feature_id: o.id,
                key: o.key,
                name: pickLocalized(o.name, i18n.language),
                runs: "",
                tokens: "",
                usd: "",
              },
            ])
          }
        />
        <p className="text-caption text-muted-foreground">{t("tenants.quota.note")}</p>
        {q.dirty ? <SaveBar saving={q.saving} onCancel={q.reset} /> : null}
      </form>
      <LazyConflictDialog props={q.conflictProps} />
    </>
  );
}
