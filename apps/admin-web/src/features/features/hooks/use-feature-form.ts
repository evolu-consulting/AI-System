// ADM-FR-30, ADM-BR-10 · form editor Feature: lưu (POST/PATCH kèm version), chặn lưu khi bỏ command làm mồ côi, ánh xạ lỗi server.
import type { FeatureDetail } from "@ai/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useCreateFeature, useUpdateFeature } from "../api";
import {
  emptyFeatureForm,
  type FeatureFormValues,
  featureSchema,
  removedOrphans,
  toCreateBody,
  toFormValues,
  toUpdateBody,
} from "../lib/schemas";

/** `onReload`: nạp lại dữ liệu mới nhất rồi dựng lại form (toast `Tải lại` khi `VERSION_CONFLICT`). */
export function useFeatureForm(feature: FeatureDetail | undefined, onReload: () => void) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const router = useRouter();
  const create = useCreateFeature();
  const update = useUpdateFeature();
  const form = useForm<FeatureFormValues>({
    resolver: zodResolver(featureSchema as never) as unknown as Resolver<FeatureFormValues>,
    mode: "onTouched",
    defaultValues: feature ? toFormValues(feature) : emptyFeatureForm(),
  });
  /** Đã bấm Lưu khi còn command mồ côi (hiện câu chặn ở thanh lưu). */
  const [needsFeature, setNeedsFeature] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const isDirty = form.formState.isDirty;
  // Version dùng cho PATCH kế tiếp: lấy từ phản hồi lưu, không đợi refetch (tránh dựng lại form làm mất chỉnh sửa vừa gõ).
  const version = useRef(feature?.version ?? 0);
  // Đếm chỉnh sửa để biết người dùng có gõ thêm trong lúc chờ phản hồi lưu hay không.
  const edits = useRef(0);
  useEffect(() => {
    const sub = form.watch(() => {
      edits.current += 1;
    });
    return () => sub.unsubscribe();
  }, [form]);

  // Tạo xong: chờ cờ "chưa lưu" tắt (UnsavedGuard) rồi mới chuyển sang trang sửa.
  useEffect(() => {
    if (createdId && !isDirty) {
      void router.navigate({
        to: "/features/$featureId",
        params: { featureId: createdId },
        replace: true,
      });
    }
  }, [createdId, isDirty, router]);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
    if (err instanceof ApiError && err.code === "KEY_TAKEN") {
      return form.setError("key", { message: "features.error.keyTaken" }, { shouldFocus: true });
    }
    if (err instanceof ApiError && err.code === "COMMAND_NEEDS_FEATURE")
      return setNeedsFeature(true);
    const spec = describeError(err);
    const reload = {
      label: t("common.reload"),
      onClick: onReload,
    };
    notifyError(
      tr(spec.key, spec.params),
      err instanceof ApiError && err.code === "VERSION_CONFLICT" ? reload : undefined,
    );
  };

  const save = async (values: FeatureFormValues) => {
    setNeedsFeature(false);
    const editsAtSubmit = edits.current;
    if (feature && removedOrphans(feature.commands, values.command_ids).length > 0) {
      return setNeedsFeature(true);
    }
    try {
      if (!feature) {
        const res = await create.mutateAsync(toCreateBody(values));
        notifySuccess(t("features.toast.saved", { name: pickLocalized(res.name, i18n.language) }));
        form.reset(values);
        setCreatedId(res.id);
        return;
      }
      const res = await update.mutateAsync({
        id: feature.id,
        ...toUpdateBody(values, version.current, feature.is_core),
      });
      version.current = res.version;
      // Không gõ thêm → form khớp bản đã lưu (hết "chưa lưu"); có gõ thêm → giữ phần mới gõ.
      form.reset(toFormValues(res), { keepDirtyValues: edits.current !== editsAtSubmit });
      notifySuccess(t("features.toast.saved", { name: pickLocalized(res.name, i18n.language) }));
    } catch (err) {
      fail(err);
    }
  };

  return { form, save, needsFeature, pending: create.isPending || update.isPending };
}
