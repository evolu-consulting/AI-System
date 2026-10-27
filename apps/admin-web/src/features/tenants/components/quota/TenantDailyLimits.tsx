// tenant-quotas · thẻ "Hạn mức theo ngày" trong tab Quota của công ty (platform_admin): 3 ô (trống = mặc định hệ thống),
// "hôm nay đã dùng X / Y", nút "Đặt lại hôm nay" từng loại (xác nhận; ghi nhật ký ở server). Form riêng, lưu riêng.
import { DAILY_LIMIT_KINDS, type DailyLimitItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/http";
import { useDailyLimits } from "../../hooks/use-daily-limits";
import { parseLimit } from "../../lib/daily-limits-draft";

function UsedLine({ item, fmt }: { item: DailyLimitItem; fmt: (n: number | null) => string }) {
  const { t } = useTranslation();
  const limit = item.effective === null ? t("tenants.dailyLimits.unlimited") : fmt(item.effective);
  return (
    <span className="text-caption text-muted-foreground" data-testid={`daily-used-${item.kind}`}>
      {t("tenants.dailyLimits.usedToday", { used: fmt(item.used), limit })}
    </span>
  );
}

export function TenantDailyLimits({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const s = useDailyLimits(tenantId);
  const nf = new Intl.NumberFormat(i18n.language);
  const fmt = (n: number | null) => (n === null ? t("tenants.dailyLimits.unknown") : nf.format(n));
  if (s.q.isPending) return <Skeleton className="h-40 w-full" />;
  if (s.q.error) {
    const e = s.q.error;
    return (
      <ErrorState
        message={e.message}
        code={e instanceof ApiError ? String(e.code) : "NETWORK_ERROR"}
        onRetry={() => void s.q.refetch()}
      />
    );
  }
  const items = new Map((s.q.data?.items ?? []).map((i) => [i.kind, i]));
  const confirmItem = s.confirm ? items.get(s.confirm) : undefined;
  return (
    <section
      className="space-y-3 rounded-md border border-border p-4"
      aria-label={t("tenants.dailyLimits.title")}
    >
      <div>
        <h2 className="text-h3 font-semibold">{t("tenants.dailyLimits.title")}</h2>
        <p className="text-caption text-muted-foreground">{t("tenants.dailyLimits.hint")}</p>
      </div>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void s.submit();
        }}
      >
        {DAILY_LIMIT_KINDS.map((kind) => {
          const item = items.get(kind);
          const bad = s.touched && parseLimit(kind, s.draft[kind]) === "invalid";
          const def =
            item?.env_default === null || item === undefined
              ? t("tenants.dailyLimits.unlimited")
              : nf.format(item.env_default);
          return (
            <div
              key={kind}
              className="grid gap-2 sm:grid-cols-[14rem_12rem_1fr_auto] sm:items-center"
            >
              <label htmlFor={`daily-${kind}`} className="text-label font-medium">
                {t(`tenants.dailyLimits.kind.${kind}`)}
              </label>
              <div>
                <Input
                  id={`daily-${kind}`}
                  inputMode="numeric"
                  value={s.draft[kind]}
                  placeholder={t("tenants.dailyLimits.defaultValue", { value: def })}
                  aria-invalid={bad || undefined}
                  onChange={(e) => s.set(kind, e.target.value)}
                  onBlur={s.blur}
                />
                {bad ? (
                  <p className="text-caption text-destructive">
                    {t("tenants.dailyLimits.invalid")}
                  </p>
                ) : null}
              </div>
              {item ? <UsedLine item={item} fmt={fmt} /> : <span />}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={s.resetting}
                onClick={() => s.askReset(kind)}
                aria-label={`${t("tenants.dailyLimits.reset")}: ${t(`tenants.dailyLimits.kind.${kind}`)}`}
              >
                {t("tenants.dailyLimits.reset")}
              </Button>
            </div>
          );
        })}
        {s.dirty ? (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={s.cancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={s.saving || (s.touched && s.invalid)}>
              {t("common.save")}
            </Button>
          </div>
        ) : null}
      </form>
      <ConfirmDialog
        open={s.confirm !== null}
        onOpenChange={(o) => (o ? undefined : s.askReset(null))}
        title={t("tenants.dailyLimits.resetTitle")}
        description={
          s.confirm
            ? t("tenants.dailyLimits.resetBody", {
                kind: t(`tenants.dailyLimits.kind.${s.confirm}`),
                day: confirmItem?.day ?? "",
              })
            : undefined
        }
        confirmLabel={t("tenants.dailyLimits.reset")}
        destructive
        onConfirm={s.doReset}
      />
    </section>
  );
}
