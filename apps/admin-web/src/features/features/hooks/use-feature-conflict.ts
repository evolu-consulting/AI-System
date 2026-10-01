// ADM-FR-55 · M3-R20 · TECH-DEBT #14 · lưu editor Feature (PATCH kèm version), 409 → ConflictDialog (câu có {user}, A4).
// Version cho lần lưu kế tiếp lấy từ phản hồi lưu; `Tải bản mới` gọi `onReload` (nạp lại rồi dựng lại form).
import type { FeatureDetail, FeatureUpdateRequest } from "@ai/contracts";
import { useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifySuccess } from "@/components/shared/toast";
import { pickLocalized } from "@/lib/localized";
import { useEditCounter } from "@/lib/use-edit-counter";
import { useUpdateFeature } from "../api";
import { type FeatureFormValues, toFormValues, toUpdateBody } from "../lib/schemas";

type Body = Omit<FeatureUpdateRequest, "version">;
const asFeature = (cur: unknown) => cur as FeatureDetail;

/** Body PATCH không có `version` (dùng để so với bản mới). */
function bodyOf(values: FeatureFormValues, isCore: boolean): Body {
  const { version: _v, ...body } = toUpdateBody(values, 0, isCore);
  return body;
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

export function useFeatureConflict(
  feature: FeatureDetail | undefined,
  form: UseFormReturn<FeatureFormValues>,
  fail: (err: unknown) => void,
  onReload: () => void,
) {
  const { t, i18n } = useTranslation();
  const update = useUpdateFeature();
  const version = useRef(feature?.version ?? 0);
  const edits = useEditCounter(form);
  const atSubmit = useRef(0);
  const conflict = useConflictSave<Body, FeatureDetail>({
    entity: "feature",
    mutate: (body) => update.mutateAsync({ id: feature?.id ?? "", ...body } as never),
    onSaved: (res) => {
      version.current = res.version;
      form.reset(toFormValues(res), { keepDirtyValues: edits.current !== atSubmit.current });
      notifySuccess(t("features.toast.saved", { name: pickLocalized(res.name, i18n.language) }));
    },
    onFail: fail,
    onReload,
    toComparable: (cur) => {
      const f = asFeature(cur);
      return bodyOf(toFormValues(f), f.is_core);
    },
  });
  const save = (values: FeatureFormValues) => {
    atSubmit.current = edits.current;
    const full = bodyOf(values, !!feature?.is_core);
    // Chưa đụng tới tập command thì không gửi `command_ids`: không ghi đè command người khác vừa thêm (tránh mồ côi).
    const { command_ids: _drop, ...partial } = full;
    const touched = !sameIds(values.command_ids, feature?.commands.map((c) => c.id) ?? []);
    return conflict.save(touched ? full : partial, version.current, full);
  };
  return { save, props: conflict.props, pending: update.isPending };
}
