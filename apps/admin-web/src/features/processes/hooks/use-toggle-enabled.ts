// ADM-FR-65 · CR-056 · P-a F5: bật/tắt một quy trình từ danh sách — đọc `GET :id` rồi `PUT` đủ body + `version`;
// 409 ⇒ ConflictDialog (entity `process_def`); `PROCESS_DEF_INCOMPLETE` ⇒ toast có nút mở editor.
import type { ProcessDef, ProcessDefInput, ProcessDefListItem } from "@ai/contracts/hub-admin";
import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifyError } from "@/components/shared/toast";
import { fetchDef, updateDef, useInvalidateDefs } from "../api";
import { defToInput } from "../lib/def-form";
import { errorCode, processErrorSpec } from "../lib/errors";

export function useToggleEnabled(tenantId: string | undefined) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const invalidate = useInvalidateDefs();
  const item = useRef<ProcessDefListItem | null>(null);
  const fail = (err: unknown) => {
    const spec = processErrorSpec(err);
    const target = item.current;
    const edit =
      errorCode(err) === "PROCESS_DEF_INCOMPLETE" && target
        ? {
            label: t("process.admin.list.edit"),
            onClick: () =>
              void navigate({ to: "/processes/$processId", params: { processId: target.id } }),
          }
        : undefined;
    notifyError(t(spec.key, spec.params), edit);
  };
  const cs = useConflictSave<ProcessDefInput, ProcessDef>({
    entity: "process_def",
    mutate: ({ version, ...body }) =>
      updateDef(item.current?.id ?? "", { ...body, version }, tenantId),
    onSaved: () => void invalidate(),
    onFail: fail,
    onReload: () => void invalidate(),
  });
  const toggle = async (row: ProcessDefListItem, enabled: boolean) => {
    item.current = row;
    try {
      const def = await fetchDef(row.id, tenantId);
      await cs.save({ ...defToInput(def), enabled }, def.version);
    } catch (err) {
      fail(err);
    }
  };
  return { toggle, conflictProps: cs.props };
}
