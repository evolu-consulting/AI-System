// ADM-FR-60 · tab Thông tin: mã công ty readOnly, tên, slot; thanh lưu dính đáy khi có thay đổi (Ctrl+S lưu).
import { TENANT_PROCESS_RUNS_MAX, type TenantDetail } from "@ai/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useOnline } from "@/components/shared/ConnectionBanner";
import { FormField } from "@/components/shared/form/FormField";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTr } from "@/lib/use-translate";
import { type TenantInfoValues, tenantInfoSchema } from "../lib/schemas";
import { TenantTimezoneField } from "./TenantTimezoneField";

type Props = {
  tenant: TenantDetail;
  pending: boolean;
  /** 400 `VALIDATION_ERROR` path `timezone` từ server (đã dịch). */
  timezoneError?: string | undefined;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (values: TenantInfoValues) => void;
};

const toValues = (t: TenantDetail): TenantInfoValues => ({
  name: t.name,
  slots: t.max_concurrent_sub === null ? "" : String(t.max_concurrent_sub),
  timezone: t.timezone,
  processRuns: String(t.process_runs_max ?? TENANT_PROCESS_RUNS_MAX.default),
});

export function TenantInfoForm({ tenant, pending, timezoneError, onDirtyChange, onSubmit }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const online = useOnline();
  const form = useForm<TenantInfoValues>({
    resolver: zodResolver(tenantInfoSchema),
    mode: "onTouched",
    defaultValues: toValues(tenant),
  });
  const { errors, isDirty } = form.formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);
  // Bản mới từ server (sau lưu / tải lại) → nạp lại form và coi như sạch. Chỉ `version` đổi (tab Quota vừa lưu, E22)
  // → giữ phần người dùng đang sửa.
  const loaded = useRef(toValues(tenant));
  useEffect(() => {
    const next = toValues(tenant);
    const same =
      next.name === loaded.current.name &&
      next.slots === loaded.current.slots &&
      next.timezone === loaded.current.timezone &&
      next.processRuns === loaded.current.processRuns;
    loaded.current = next;
    form.reset(next, same ? { keepDirtyValues: true } : undefined);
  }, [tenant, form]);

  const save = form.handleSubmit(onSubmit);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (form.formState.isDirty && online) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [form, online, save]);

  return (
    <form onSubmit={save} noValidate className="max-w-xl space-y-4 pb-20">
      <FormField
        id="info-key"
        label={t("tenants.field.key")}
        description={t("tenants.field.keyHint")}
      >
        {(p) => <Input {...p} value={tenant.key} readOnly className="bg-muted font-mono" />}
      </FormField>
      <FormField id="info-name" label={t("tenants.field.name")} error={msg(errors.name?.message)}>
        {(p) => <Input {...p} {...form.register("name")} autoComplete="off" />}
      </FormField>
      <FormField
        id="info-slots"
        label={t("tenants.field.slots")}
        description={t("tenants.field.slotsHint")}
        error={msg(errors.slots?.message)}
      >
        {(p) => (
          <Input {...p} {...form.register("slots")} type="number" min={1} inputMode="numeric" />
        )}
      </FormField>
      <FormField
        id="info-process-runs"
        label={t("tenants.field.processRuns")}
        description={t("tenants.field.processRunsHint")}
        error={msg(errors.processRuns?.message)}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("processRuns")}
            type="number"
            min={TENANT_PROCESS_RUNS_MAX.min}
            max={TENANT_PROCESS_RUNS_MAX.max}
            inputMode="numeric"
          />
        )}
      </FormField>
      <TenantTimezoneField
        id="info-timezone"
        value={form.watch("timezone")}
        error={msg(errors.timezone?.message) ?? timezoneError}
        onChange={(zone) =>
          form.setValue("timezone", zone, { shouldDirty: true, shouldValidate: true })
        }
      />
      <div className="flex items-center gap-3 text-body text-muted-foreground">
        <span>{t("tenants.col.status")}</span>
        {tenant.status === "locked" ? (
          <StatusBadge tone="err">{t("tenants.status.locked")}</StatusBadge>
        ) : (
          <StatusBadge tone="ok">{t("tenants.status.active")}</StatusBadge>
        )}
      </div>
      {isDirty ? (
        <div className="fixed right-0 bottom-0 left-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-drawer lg:left-sidebar">
          <span className="text-label text-muted-foreground">{t("common.unsaved")}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => form.reset(toValues(tenant))}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={pending || !online}
              title={online ? undefined : t("state.offline.saveTip")}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
