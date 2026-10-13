// HUB-FR-66 · D4/D5 · các trường của Sheet Provider theo loại. Tạo: Khoá/Loại/Hãng chọn được; Sửa: chỉ đọc + "không đổi được sau khi tạo".
// Không có ô nhập giá trị key: API key là `select` secret `provider_api_key` đã lưu ở Secrets.
import { PROVIDER_KINDS, STUDIO_PROVIDER_VENDORS } from "@ai/contracts/studio";
import { Controller, type FieldErrors, type UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { HrefLink } from "#/components/shared/HrefLink";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { FieldFrame } from "#/features/secrets/components/FieldFrame";
import type { ProviderFormValues } from "../lib/schema";

type Option = { id: string; name: string };
type Props = {
  form: UseFormReturn<ProviderFormValues>;
  mode: "create" | "edit";
  secrets: readonly Option[];
};

function Pick({
  id,
  label,
  value,
  onChange,
  options,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { id: string; label: string }[];
  error?: string;
  hint?: string;
}) {
  return (
    <FieldFrame id={id} label={label} error={error} hint={hint}>
      {(p) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger {...p} className="w-full">
            <SelectValue>{options.find((o) => o.id === value)?.label ?? null}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FieldFrame>
  );
}

const msg = (e: FieldErrors<ProviderFormValues>, k: keyof ProviderFormValues) =>
  e[k]?.message as string | undefined;

export function ProviderFields({ form, mode, secrets }: Props) {
  const { t } = useTranslation();
  const errs = form.formState.errors;
  const kind = form.watch("kind");
  const create = mode === "create";
  const kindOpts = PROVIDER_KINDS.map((k) => ({
    id: k,
    label: t(k === "api" ? "models.provider.kind.api" : "models.provider.kind.sub"),
  }));
  const vendorOpts = STUDIO_PROVIDER_VENDORS.map((v) => ({
    id: v,
    label: t(`models.provider.vendor.${v}`),
  }));
  const label = (opts: readonly { id: string; label: string }[], v: string) =>
    opts.find((o) => o.id === v)?.label ?? v;
  return (
    <>
      {create ? (
        <FieldFrame
          id="prov-key"
          label={t("models.provider.field.key")}
          error={msg(errs, "key")}
          hint={kind === "subscription" ? t("models.provider.field.subKeyHint") : undefined}
        >
          {(p) => (
            <Input {...p} {...form.register("key")} autoComplete="off" className="font-mono" />
          )}
        </FieldFrame>
      ) : null}
      {create ? (
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <Pick
              id="prov-kind"
              label={t("models.provider.field.kind")}
              value={field.value}
              onChange={field.onChange}
              options={kindOpts}
            />
          )}
        />
      ) : (
        <dl className="space-y-2">
          {[
            ["models.provider.field.kind", label(kindOpts, kind)],
            ["models.provider.field.vendor", label(vendorOpts, form.getValues("vendor"))],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-label text-muted-foreground">{t(k as string)}</dt>
              <dd>
                {v}{" "}
                <span className="text-label text-muted-foreground">
                  {t("models.provider.field.kindLocked")}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {create ? (
        <Controller
          control={form.control}
          name="vendor"
          render={({ field }) => (
            <Pick
              id="prov-vendor"
              label={t("models.provider.field.vendor")}
              value={field.value}
              onChange={field.onChange}
              options={vendorOpts}
              error={msg(errs, "vendor")}
            />
          )}
        />
      ) : null}
      {kind === "api" ? (
        <>
          <FieldFrame
            id="prov-url"
            label={t("models.provider.field.baseUrl")}
            error={msg(errs, "base_url")}
          >
            {(p) => (
              <Input {...p} {...form.register("base_url")} autoComplete="off" inputMode="url" />
            )}
          </FieldFrame>
          <Controller
            control={form.control}
            name="secret_id"
            render={({ field }) => (
              <Pick
                id="prov-secret"
                label={t("models.provider.field.secret")}
                value={field.value}
                onChange={field.onChange}
                options={secrets.map((s) => ({ id: s.id, label: s.name }))}
                error={msg(errs, "secret_id")}
                hint={t("models.provider.field.secretHint")}
              />
            )}
          />
          <HrefLink
            path="/secrets?kind=provider_api_key&drawer=new"
            className="text-primary underline"
          >
            {t("models.provider.field.createSecret")}
          </HrefLink>
        </>
      ) : (
        <>
          <FieldFrame
            id="prov-slots"
            label={t("models.provider.field.slots")}
            error={msg(errs, "max_concurrency")}
            hint={t("models.provider.field.slotsHint")}
          >
            {(p) => (
              <Input {...p} {...form.register("max_concurrency")} type="number" min={1} max={100} />
            )}
          </FieldFrame>
          <p className="text-label text-muted-foreground">{t("models.provider.field.subNote")}</p>
        </>
      )}
      <div className="flex items-center gap-2">
        <Controller
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <Checkbox
              id="prov-enabled"
              checked={field.value}
              onCheckedChange={(v) => field.onChange(v === true)}
            />
          )}
        />
        <Label htmlFor="prov-enabled">{t("models.provider.field.enabled")}</Label>
      </div>
    </>
  );
}
