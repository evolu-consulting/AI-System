// ADM-FR-50 · M2-R04 · nối drawer với API: nạp secret khi thay giá trị/sửa ghi chú, lưu, ánh xạ lỗi server vào ô.
// D10: không đưa giá trị vào toast/URL; mutation `gcTime: 0` + `reset()` sau khi xong.
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { normalizeSecretName } from "@/lib/normalize";
import { useTr } from "@/lib/use-translate";
import { useCreateSecret, useReplaceSecret, useSecretByName, useUpdateSecretNote } from "../api";
import { SecretDrawer } from "../components/SecretDrawer";
import type { SecretFormErrors } from "../components/SecretForm";
import {
  fieldFromIssues,
  noteToValue,
  type SecretFormMode,
  type SecretFormValues,
} from "../lib/schemas";

type Props = { mode: SecretFormMode; name?: string; onClose: () => void };

const REPLACED_TOAST_MS = 8000;

export function SecretDrawerController({ mode, name, onClose }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const router = useRouter();
  const lookup = useSecretByName(name, mode !== "create");
  const create = useCreateSecret();
  const replace = useReplaceSecret(name ?? "");
  const updateNote = useUpdateSecretNote(name ?? "");
  const [errors, setErrors] = useState<SecretFormErrors>({});
  const [gone, setGone] = useState(false);

  const secret = lookup.data ?? undefined;
  const notFound = mode !== "create" && (gone || lookup.isError || lookup.data === null);

  const fail = (err: unknown) => {
    if (!(err instanceof ApiError)) return notifyError(tr("toast.saveFailed", { reason: "" }));
    if (err.code === "UNAUTHORIZED") return; // modal phiên hết hạn xử lý
    if (err.code === "NOT_FOUND") return setGone(true);
    if (err.code === "SECRET_NAME_TAKEN") return setErrors({ name: t("secrets.error.nameTaken") });
    const issue = err.code === "VALIDATION_ERROR" ? fieldFromIssues(err.details) : null;
    if (issue) return setErrors({ [issue.field]: t(issue.key) });
    // Không hiển thị `message` server của /admin/secrets* (G12): lý do để trống.
    const spec =
      err.code === "VALIDATION_ERROR"
        ? { key: "toast.saveFailed", params: { reason: "" } }
        : describeError(err);
    notifyError(tr(spec.key, spec.params));
  };

  const run = async (v: SecretFormValues) => {
    if (mode === "create") {
      const note = noteToValue(v.note);
      const created = await create.mutateAsync({
        name: normalizeSecretName(v.name),
        value: v.value,
        ...(note ? { note } : {}),
      });
      create.reset();
      notifySuccess(t("secrets.toast.created", { name: created.name }));
    } else if (mode === "replace") {
      const res = await replace.mutateAsync({ value: v.value });
      replace.reset();
      notifySuccess(
        t("secrets.toast.replaced", { name: res.name, last4: res.last4 }),
        {
          label: t("secrets.toast.viewWorkflows"),
          onClick: () => void router.navigate({ to: "/workflows", search: { secret: res.name } }),
        },
        REPLACED_TOAST_MS,
      );
    } else {
      const res = await updateNote.mutateAsync({ note: noteToValue(v.note) });
      notifySuccess(t("secrets.toast.noteSaved", { name: res.name }));
    }
    onClose();
  };

  const submit = async (v: SecretFormValues) => {
    setErrors({});
    try {
      await run(v);
    } catch (err) {
      fail(err);
    }
  };

  return (
    <SecretDrawer
      mode={mode}
      secret={secret}
      loading={mode !== "create" && lookup.isPending}
      notFound={notFound}
      pending={create.isPending || replace.isPending || updateNote.isPending}
      serverErrors={errors}
      onSubmit={submit}
      onClose={onClose}
    />
  );
}
