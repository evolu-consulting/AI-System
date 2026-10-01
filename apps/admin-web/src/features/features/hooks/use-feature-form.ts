// ADM-FR-30, ADM-BR-10 · form editor Feature: lưu (POST/PATCH kèm version), chặn lưu khi bỏ command làm mồ côi, ánh xạ lỗi server.
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
  removedOrphans,
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

/** Lỗi lưu: `KEY_TAKEN` → ô Key, `COMMAND_NEEDS_FEATURE` → câu chặn ở thanh lưu, còn lại toast bền (409 version: ConflictDialog). */
function useSaveFail(form: Form, markNeedsFeature: () => void) {
  const tr = useTr();
  return (err: unknown) => {
    const code = err instanceof ApiError ? err.code : null;
    if (code === "UNAUTHORIZED") return;
    if (code === "KEY_TAKEN") {
      return form.setError("key", { message: "features.error.keyTaken" }, { shouldFocus: true });
    }
    if (code === "COMMAND_NEEDS_FEATURE") return markNeedsFeature();
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
  /** Đã bấm Lưu khi còn command mồ côi (hiện câu chặn ở thanh lưu). */
  const [needsFeature, setNeedsFeature] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  useCreatedRedirect(createdId, form.formState.isDirty);
  const fail = useSaveFail(form, () => setNeedsFeature(true));
  const fc = useFeatureConflict(feature, form, fail, onReload);
  const saved = (name: FeatureDetail["name"]) =>
    notifySuccess(t("features.toast.saved", { name: pickLocalized(name, i18n.language) }));

  const save = async (values: FeatureFormValues) => {
    const orphaned = !!feature && removedOrphans(feature.commands, values.command_ids).length > 0;
    setNeedsFeature(orphaned);
    if (orphaned) return;
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

  return { form, save, needsFeature, pending: create.isPending || fc.pending, conflict: fc.props };
}
