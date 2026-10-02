// ADM-FR-62 · M3-R01 · form tạo group (/groups/new): POST (platform gửi tenant_id), `KEY_TAKEN` → ô Key, rồi sang editor.

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useCreateGroup } from "../api";
import type { GroupFormValues } from "../lib/schemas";
import { emptyGroupForm, groupCreateSchema, toCreateBody } from "../lib/schemas";

/** Tạo xong: chờ cờ "chưa lưu" tắt (UnsavedGuard) rồi mới chuyển sang editor. */
function useCreatedRedirect(createdId: string | null, isDirty: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (createdId && !isDirty) {
      void router.navigate({
        to: "/groups/$groupId",
        params: { groupId: createdId },
        search: { tab: "members" },
        replace: true,
      });
    }
  }, [createdId, isDirty, router]);
}

export function useGroupForm(tenantId: string | undefined) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const create = useCreateGroup(tenantId);
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupCreateSchema),
    mode: "onTouched",
    defaultValues: emptyGroupForm(),
  });
  const [createdId, setCreatedId] = useState<string | null>(null);
  useCreatedRedirect(createdId, form.formState.isDirty);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
    if (err instanceof ApiError && err.code === "KEY_TAKEN") {
      form.setError("key", { message: "groups.error.keyTaken" }, { shouldFocus: true });
      return;
    }
    const spec = describeError(err);
    notifyError(tr(spec.key, spec.params));
  };
  const submit = form.handleSubmit(async (values) => {
    try {
      const res = await create.mutateAsync(toCreateBody(values));
      notifySuccess(t("groups.toast.created", { name: pickLocalized(res.name, i18n.language) }));
      form.reset(values); // bỏ cờ "chưa lưu" trước khi rời trang
      setCreatedId(res.id);
    } catch (err) {
      fail(err);
    }
  });
  return { form, submit, pending: create.isPending };
}
