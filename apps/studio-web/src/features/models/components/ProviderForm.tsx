// HUB-FR-66 · D4/D8/D10 · form Sheet Provider: tạo (POST) / sửa (PUT kèm version). Sheet đóng sau khi lưu thành công;
// 409 phiên bản → ConflictDialog dùng chung; KEY_TAKEN/VALIDATION → lỗi dưới ô.
import type { ProviderCreate, ProviderDetail } from "@ai/contracts/studio";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConflictDialog } from "#/components/shared/conflict/ConflictDialog";
import { useConflict } from "#/components/shared/conflict/use-conflict";
import { Button } from "#/components/ui/button";
import { SheetFooter } from "#/components/ui/sheet";
import { useSecrets } from "#/features/secrets/hooks/use-secrets";
import { useProviderMutations } from "../hooks/use-provider-mutations";
import { classifySaveError } from "../lib/save-error";
import { type ProviderFormValues, providerFormSchema } from "../lib/schema";
import { ProviderFields } from "./ProviderFields";

const blank: ProviderFormValues = {
  key: "",
  kind: "api",
  vendor: "",
  base_url: "",
  secret_id: "",
  max_concurrency: "1",
  enabled: true,
};
const fromDetail = (d: ProviderDetail): ProviderFormValues => ({
  key: d.key,
  kind: d.kind as ProviderFormValues["kind"],
  vendor: d.vendor,
  base_url: d.base_url ?? "",
  secret_id: d.secret?.id ?? "",
  max_concurrency: String(d.max_concurrency),
  enabled: d.enabled,
});

export function ProviderForm({
  detail,
  onClose,
  onGuide,
}: {
  detail: ProviderDetail | null;
  onClose: () => void;
  onGuide?: () => void;
}) {
  const { t } = useTranslation();
  const m = useProviderMutations();
  const mode = detail ? "edit" : "create";
  const schema = useMemo(() => providerFormSchema(mode), [mode]);
  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(schema),
    defaultValues: detail ? fromDetail(detail) : blank,
  });
  const list = useSecrets("provider_api_key");
  const secrets = useMemo(() => {
    const opts = list.items.map((s) => ({ id: s.id, name: s.name }));
    return detail?.secret && !opts.some((o) => o.id === detail.secret?.id)
      ? [...opts, detail.secret]
      : opts;
  }, [list.items, detail]);

  const send = async (version: number, v: ProviderFormValues) => {
    const api = v.kind === "api";
    const common = {
      base_url: api && v.base_url.trim() !== "" ? v.base_url.trim() : null,
      secret_id: api ? v.secret_id : null,
      max_concurrency: api && !detail ? 1 : Number(v.max_concurrency),
      enabled: v.enabled,
    };
    const key = detail?.key ?? v.key.trim();
    if (detail) await m.update({ id: detail.id, body: { version, ...common } });
    else await m.create({ key, kind: v.kind, vendor: v.vendor, ...common } as ProviderCreate);
    toast.success(t("models.provider.toast.saved", { key }));
    onClose();
  };
  const fail = (err: unknown) => {
    const f = classifySaveError(err);
    if (f.field) form.setError(f.field, { message: f.message });
    if (f.toast) toast.error(t(f.toast.key, f.toast.params));
  };
  const conflict = useConflict<ProviderDetail>({
    buildRows: () => ({ rows: [], more: 0 }),
    submit: (version) => send(version, form.getValues()),
    onReload: () => {
      m.reload();
      onClose();
    },
    onError: fail,
  });
  const submit = form.handleSubmit(async (v) => {
    const version = detail?.version ?? 1;
    try {
      await send(version, v);
    } catch (err) {
      if (!conflict.capture(err, version)) fail(err);
    }
  });

  return (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <div className="flex-1 space-y-4 overflow-y-auto px-4">
        <ProviderFields form={form} mode={mode} secrets={secrets} onGuide={onGuide} />
      </div>
      <SheetFooter className="flex-row justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("models.provider.sheet.cancel")}
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {t(
            form.formState.isSubmitting
              ? "models.provider.sheet.saving"
              : "models.provider.sheet.save",
          )}
        </Button>
      </SheetFooter>
      {conflict.props ? <ConflictDialog {...conflict.props} /> : null}
    </form>
  );
}
