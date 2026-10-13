// HUB-FR-131 · HUB-FR-132 · D4/D7 · form Thêm/Sửa kết nối: RHF + zod (key i18n), lỗi server theo trường, 409 ⇒ ConflictDialog.
import type { KhConnection } from "@ai/contracts/hub-admin";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConflictDialog } from "#/components/shared/conflict/ConflictDialog";
import { useConflict } from "#/components/shared/conflict/use-conflict";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { SheetFooter } from "#/components/ui/sheet";
import type { MessageSpec } from "#/lib/api-error";
import { useKhMutations } from "../hooks/use-kh-mutations";
import { classifyKhSaveError, type KhField as Field } from "../lib/save-error";
import { type KhFormValues, khFormSchema, toBody } from "../lib/schema";
import { KhField } from "./KhField";
import { KhKeyField } from "./KhKeyField";

type Props = {
  item?: KhConnection;
  saved: number | null;
  onSaved: (version: number) => void;
  onClose: () => void;
};

const key = (m?: string): MessageSpec | undefined => (m ? { key: m } : undefined);

export function KhConnectionForm({ item, saved, onSaved, onClose }: Props) {
  const { t } = useTranslation();
  const m = useKhMutations();
  const [srv, setSrv] = useState<Partial<Record<Field, MessageSpec>>>({});
  const form = useForm<KhFormValues>({
    resolver: zodResolver(khFormSchema),
    defaultValues: {
      name: item?.name ?? "",
      base_url: item?.base_url ?? "",
      secret_id: item?.secret.id ?? "",
      summary_project: item?.summary_project ?? "",
    },
  });
  const errs = form.formState.errors;
  const w = form.watch();
  const done = saved !== null;
  const resets = !!item && (w.base_url.trim() !== item.base_url || w.secret_id !== item.secret.id);
  const clear = (f: Field) => srv[f] && setSrv({ ...srv, [f]: undefined });

  const send = async (version: number, v: KhFormValues) => {
    const body = toBody(v);
    const res = item
      ? await m.update({ id: item.id, body: { ...body, version } })
      : await m.create(body);
    setSrv({});
    toast.success(t("knowledgehub.toast.saved", { name: res.name }));
    // Thêm / Sửa: Sheet ở lại "Đã lưu · v{n}" (plan-frontend §2); danh sách phía sau đã làm mới.
    onSaved(res.version);
  };
  const fail = (err: unknown) => {
    const f = classifyKhSaveError(err);
    if (f.field && f.message) setSrv({ [f.field]: f.message });
    if (f.toast) toast.error(t(f.toast.key, f.toast.params));
  };
  const conflict = useConflict<KhConnection>({
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
    setSrv({});
    try {
      await send(version, v);
    } catch (err) {
      if (!conflict.capture(err, version)) fail(err);
    }
  });
  const reg = (name: "name" | "base_url") => ({
    ...form.register(name, { onChange: () => clear(name) }),
    autoComplete: "off",
    spellCheck: false,
    disabled: done,
  });

  return (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <div className="flex-1 space-y-4 overflow-y-auto px-4">
        <KhField
          id="kh-name"
          label={t("knowledgehub.sheet.name")}
          error={srv.name ?? key(errs.name?.message)}
        >
          {(p) => <Input {...p} {...reg("name")} />}
        </KhField>
        <KhField
          id="kh-url"
          label={t("knowledgehub.sheet.url")}
          error={srv.base_url ?? key(errs.base_url?.message)}
        >
          {(p) => <Input {...p} {...reg("base_url")} inputMode="url" className="font-mono" />}
        </KhField>
        <Controller
          control={form.control}
          name="secret_id"
          render={({ field }) => (
            <KhKeyField
              value={field.value}
              onChange={(v) => {
                field.onChange(v);
                clear("secret_id");
              }}
              current={item?.secret}
              disabled={done}
              error={srv.secret_id ?? key(errs.secret_id?.message)}
            />
          )}
        />
        <KhField
          id="kh-project"
          label={t("knowledgehub.sheet.project")}
          hint={t("knowledgehub.sheet.projectHint")}
          error={key(errs.summary_project?.message)}
        >
          {(p) => (
            <Input
              {...p}
              {...form.register("summary_project")}
              autoComplete="off"
              spellCheck={false}
              disabled={done}
              className="font-mono"
            />
          )}
        </KhField>
        {resets && !done ? <Alert>{t("knowledgehub.sheet.resetWarn")}</Alert> : null}
        {done ? (
          <p role="status" className="text-label font-medium text-success">
            {t("knowledgehub.sheet.saved", { n: saved })}
          </p>
        ) : null}
      </div>
      <SheetFooter className="flex-row justify-end gap-2">
        {done ? (
          <Button type="button" onClick={onClose}>
            {t("knowledgehub.sheet.close")}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("knowledgehub.sheet.cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t(
                form.formState.isSubmitting
                  ? "knowledgehub.sheet.saving"
                  : "knowledgehub.sheet.save",
              )}
            </Button>
          </>
        )}
      </SheetFooter>
      {conflict.props ? <ConflictDialog {...conflict.props} /> : null}
    </form>
  );
}
