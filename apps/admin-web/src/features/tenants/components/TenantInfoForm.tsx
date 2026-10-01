// ADM-FR-60 · tab Thông tin: mã công ty readOnly, tên, slot; thanh lưu dính đáy khi có thay đổi (Ctrl+S lưu).
import type { TenantDetail } from "@ai/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useOnline } from "@/components/shared/ConnectionBanner";
import { FormField } from "@/components/shared/FormField";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTr } from "@/lib/use-translate";
import { type TenantInfoValues, tenantInfoSchema } from "../lib/schemas";

type Props = {
  tenant: TenantDetail;
  pending: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (values: TenantInfoValues) => void;
};

const toValues = (t: TenantDetail): TenantInfoValues => ({
  name: t.name,
  slots: t.max_concurrent_sub === null ? "" : String(t.max_concurrent_sub),
});

export function TenantInfoForm({ tenant, pending, onDirtyChange, onSubmit }: Props) {
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

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);
  // Bản mới từ server (sau lưu / tải lại) → nạp lại form và coi như sạch.
  useEffect(() => form.reset(toValues(tenant)), [tenant, form]);

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
