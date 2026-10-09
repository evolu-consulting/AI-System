// ADM-FR-30 · form editor Feature: lưu (POST/PATCH kèm version), ánh xạ lỗi server. CR-055: bỏ command làm nó
// "chưa gắn feature" chỉ cảnh báo ở tab Commands, không chặn lưu.
import type { FeatureDetail } from "@ai/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type Resolver, type UseFormReturn, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useCreateFeature } from "../api";
import {
  emptyFeatureForm,
  type FeatureFormValues,
  featureSchema,
  toCreateBody,
  toFormValues,
} from "../lib/schemas";
import { useFeatureConflict } from "./use-feature-conflict";

type Form = UseFormReturn<FeatureFormValues>;

/** Tạo xong: chờ cờ "chưa lưu" tắt (UnsavedGuard) rồi mới chuyển sang trang sửa. */
function useCreatedRedirect(createdId: string | null, isDirty: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (createdId && !isDirty) {
      void router.navigate({
        to: "/features/$featureId",
        params: { featureId: createdId },
        replace: true,
      });
    }
  }, [createdId, isDirty, router]);
}

/** Lỗi lưu: `KEY_TAKEN` → ô Key, còn lại toast bền (409 version: ConflictDialog). */
function useSaveFail(form: Form) {
  const tr = useTr();
  return (err: unknown) => {
    const code = err instanceof ApiError ? err.code : null;
    if (code === "UNAUTHORIZED") return;
    if (code === "KEY_TAKEN") {
      return form.setError("key", { message: "features.error.keyTaken" }, { shouldFocus: true });
    }
    const spec = describeError(err);
    notifyError(tr(spec.key, spec.params));
  };
}

/** `onReload`: nạp lại dữ liệu mới nhất rồi dựng lại form (`Tải bản mới` của ConflictDialog). */
export function useFeatureForm(feature: FeatureDetail | undefined, onReload: () => void) {
  const { t, i18n } = useTranslation();
  const create = useCreateFeature();
  const form = useForm<FeatureFormValues>({
    resolver: zodResolver(featureSchema as never) as unknown as Resolver<FeatureFormValues>,
    mode: "onTouched",
    defaultValues: feature ? toFormValues(feature) : emptyFeatureForm(),
  });
  const [createdId, setCreatedId] = useState<string | null>(null);
  useCreatedRedirect(createdId, form.formState.isDirty);
  const fail = useSaveFail(form);
  const fc = useFeatureConflict(feature, form, fail, onReload);
  const saved = (name: FeatureDetail["name"]) =>
    notifySuccess(t("features.toast.saved", { name: pickLocalized(name, i18n.language) }));

  const save = async (values: FeatureFormValues) => {
    try {
      if (feature) return void (await fc.save(values));
      const res = await create.mutateAsync(toCreateBody(values));
      saved(res.name);
      form.reset(values);
      setCreatedId(res.id);
    } catch (err) {
      fail(err);
    }
  };

  return { form, save, pending: create.isPending || fc.pending, conflict: fc.props };
}
