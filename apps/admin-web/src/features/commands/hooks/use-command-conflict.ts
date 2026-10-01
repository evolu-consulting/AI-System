// ADM-FR-55 · M3-R20 · TECH-DEBT #14 · lưu editor Command (PATCH kèm version), 409 → ConflictDialog (câu có {user}, A4).
// Version cho lần lưu kế tiếp lấy từ phản hồi lưu; form `reset` khi lưu xong (giữ phần vừa gõ thêm) hoặc `Tải bản mới`.
import type { Command } from "@ai/contracts";
import { useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifySuccess } from "@/components/shared/toast";
import { useEditCounter } from "@/lib/use-edit-counter";
import { useUpdateCommand } from "../api";
import { toFormValues, toRequestBody } from "../lib/defaults";
import type { CommandFormValues } from "../lib/schemas";

type Body = ReturnType<typeof toRequestBody>;
const asCommand = (cur: unknown) => cur as Command;

export function useCommandConflict(
  command: Command | undefined,
  form: UseFormReturn<CommandFormValues>,
  fail: (err: unknown, name: string) => void,
) {
  const { t } = useTranslation();
  const update = useUpdateCommand();
  const version = useRef(command?.version ?? 0);
  const edits = useEditCounter(form);
  const atSubmit = useRef(0);
  const conflict = useConflictSave<Body, Command>({
    entity: "command",
    mutate: (body) => update.mutateAsync({ id: command?.id ?? "", ...body }),
    onSaved: (res) => {
      version.current = res.version;
      form.reset(toFormValues(res), { keepDirtyValues: edits.current !== atSubmit.current });
      notifySuccess(t("commands.toast.saved", { name: res.name }));
    },
    onFail: (err) => fail(err, form.getValues("name")),
    onReload: (cur) => {
      version.current = cur.version;
      form.reset(toFormValues(asCommand(cur)));
    },
    toComparable: (cur) => toRequestBody(toFormValues(asCommand(cur))),
  });
  const save = (values: CommandFormValues) => {
    atSubmit.current = edits.current;
    return conflict.save(toRequestBody(values), version.current);
  };
  return { save, props: conflict.props, pending: update.isPending };
}
