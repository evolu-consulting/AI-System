// HUB-FR-68 · HUB-FR-69 · AC-H4b1-08 · Sheet thêm / thay giá trị secret. D4: giá trị chỉ ở state RHF; D9: sau lưu Sheet ở lại,
// ô `disabled` value rỗng, footer chỉ [Đóng] (D10: ẩn nút X). Lỗi giữ nguyên form để [Ghi đè]/sửa tên.

import type { HubSecret, HubSecretKind } from "@ai/contracts/hub-admin";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConflictDialog } from "#/components/shared/conflict/ConflictDialog";
import { useConflict } from "#/components/shared/conflict/use-conflict";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { useSecretMutations } from "../hooks/use-secret-mutations";
import { classifySaveError } from "../lib/save-error";
import { PLATFORM, type SecretFormValues, secretFormSchema } from "../lib/schema";
import { FieldFrame } from "./FieldFrame";
import { ScopeField } from "./ScopeField";
import { SecretValueField } from "./SecretValueField";

export type SheetTarget =
  | { kind: "create"; secretKind: HubSecretKind }
  | { kind: "replace"; item: HubSecret };

type BodyProps = {
  target: SheetTarget;
  onClose: () => void;
  saved: number | null;
  onSaved: (version: number) => void;
};

function ReadonlyInfo({ item }: { item: HubSecret }) {
  const { t } = useTranslation();
  return (
    <dl className="space-y-2">
      <div>
        <dt className="text-label text-muted-foreground">{t("secrets.field.name")}</dt>
        <dd className="font-mono">{item.name}</dd>
      </div>
      {item.kind !== "provider_api_key" ? (
        <div>
          <dt className="text-label text-muted-foreground">{t("secrets.field.scope")}</dt>
          <dd>{item.tenant?.name ?? t("secrets.scope.platform")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function SheetBody({ target, onClose, saved, onSaved }: BodyProps) {
  const { t } = useTranslation();
  const m = useSecretMutations();
  const item = target.kind === "replace" ? target.item : undefined;
  const kind = item?.kind ?? (target.kind === "create" ? target.secretKind : "provider_api_key");
  const schema = useMemo(() => secretFormSchema(!item), [item]);
  const form = useForm<SecretFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: item?.name ?? "", scope: PLATFORM, value: "" },
  });
  const errs = form.formState.errors;

  const send = async (version: number, v: SecretFormValues) => {
    const res = item
      ? await m.rotate({ id: item.id, body: { version, value: v.value } })
      : await m.create({
          kind,
          name: v.name,
          value: v.value,
          ...(kind === "kh_api_key" && v.scope !== PLATFORM ? { tenant_id: v.scope } : {}),
        });
    onSaved(res.version);
    form.reset({ ...v, value: "" });
    toast.success(t(item ? "secrets.toast.replaced" : "secrets.toast.created", { name: v.name }));
  };
  const fail = (err: unknown) => {
    const f = classifySaveError(err);
    if (f.field) form.setError(f.field, { message: f.message });
    if (f.toast) toast.error(t(f.toast.key, f.toast.params));
  };
  const conflict = useConflict<HubSecret>({
    buildRows: () => ({ rows: [], more: 0 }),
    submit: (version) => send(version, form.getValues()),
    onReload: () => {
      m.reload();
      onClose();
    },
    onError: fail,
  });
  const submit = form.handleSubmit(async (v) => {
    const version = item?.version ?? 1;
    try {
      await send(version, { ...v, name: item?.name ?? v.name });
    } catch (err) {
      if (!conflict.capture(err, version)) fail(err);
    }
  });
  const hasValue = form.watch("value") !== "";
  const done = saved !== null;

  return (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <div className="flex-1 space-y-4 overflow-y-auto px-4">
        {item ? (
          <ReadonlyInfo item={item} />
        ) : (
          <FieldFrame id="secret-name" label={t("secrets.field.name")} error={errs.name?.message}>
            {(p) => (
              <Input
                {...p}
                {...form.register("name")}
                autoComplete="off"
                spellCheck={false}
                disabled={done}
                className="font-mono"
              />
            )}
          </FieldFrame>
        )}
        {!item && kind === "kh_api_key" ? (
          <Controller
            control={form.control}
            name="scope"
            render={({ field }) => (
              <ScopeField
                value={field.value}
                onChange={field.onChange}
                disabled={done}
                error={errs.scope?.message}
              />
            )}
          />
        ) : null}
        <SecretValueField
          registration={form.register("value")}
          hasValue={hasValue}
          disabled={done}
          error={errs.value?.message}
        />
        {done ? (
          <p role="status" className="text-label font-medium text-success">
            {t("secrets.sheet.saved", { n: saved })}
          </p>
        ) : null}
      </div>
      <SheetFooter className="flex-row justify-end gap-2">
        {done ? (
          <Button type="button" onClick={onClose}>
            {t("secrets.sheet.close")}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("secrets.sheet.cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t(form.formState.isSubmitting ? "secrets.sheet.saving" : "secrets.sheet.save")}
            </Button>
          </>
        )}
      </SheetFooter>
      {conflict.props ? <ConflictDialog {...conflict.props} /> : null}
    </form>
  );
}

export function SecretSheet({
  target,
  onClose,
}: {
  target: SheetTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<number | null>(null);
  const close = () => {
    setSaved(null);
    onClose();
  };
  const title =
    target?.kind === "replace"
      ? t("secrets.sheet.replace", { name: target.item.name })
      : t("secrets.sheet.create");
  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && close()}>
      <SheetContent className="sm:max-w-md" showCloseButton={saved === null}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">{t("secrets.subtitle")}</SheetDescription>
        </SheetHeader>
        {target ? (
          <SheetBody
            key={target.kind === "replace" ? target.item.id : `new:${target.secretKind}`}
            target={target}
            onClose={close}
            saved={saved}
            onSaved={setSaved}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
