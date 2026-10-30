// CR-105 · L3: state + lưu của Form (slot_body). Lưu = `PUT /process-defs/:id` kèm `slot_body` (Hub biên dịch ra `stages`);
// 409 ⇒ ConflictDialog (entity `process_def`); lỗi khác ⇒ toast theo mã Hub.
import { useEffect, useMemo, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { defToInput } from "../lib/def-form";
import { processErrorSpec } from "../lib/errors";
import {
  flowReducer,
  type LibStep,
  parseSlotBody,
  toSlotBody,
  validateFlow,
} from "../lib/flow-form";
import {
  type LibraryDef,
  type LibraryDefBody,
  saveLibraryDef,
  useLibraryRefresh,
} from "../library-api";

export function useFlowForm(def: LibraryDef, onDirtyChange: (dirty: boolean) => void) {
  const { t } = useTranslation();
  const refresh = useLibraryRefresh();
  const saved = useMemo(() => parseSlotBody(def.slot_body), [def.slot_body]);
  const [steps, dispatch] = useReducer(flowReducer, saved ?? []);
  const loadedKey = useRef<string | null>(null);
  const key = `${def.id}:${def.version}`;
  // Nạp lại khi bản nháp đổi (lưu xong / canvas lưu / mở quy trình khác); không đè khi chỉ làm tươi nền.
  useEffect(() => {
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    dispatch({ type: "load", steps: saved ?? [] });
  }, [key, saved]);

  const issues = validateFlow(steps);
  const dirty = saved !== null && JSON.stringify(steps) !== JSON.stringify(saved);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const cs = useConflictSave<LibraryDefBody, LibraryDef>({
    entity: "process_def",
    mutate: ({ version, ...body }) => saveLibraryDef(def.id, { ...body, version }),
    onSaved: () => {
      notifySuccess(t("common.saved"));
      void refresh();
    },
    onFail: (err) => {
      const s = processErrorSpec(err);
      notifyError(t(s.key, s.params));
    },
    onReload: () => void refresh(),
  });
  const save = async (list: readonly LibStep[]) => {
    const body: LibraryDefBody = {
      ...defToInput(def),
      slot: def.slot ?? null,
      slot_body: toSlotBody(list),
    };
    await cs.save(body, def.version);
  };
  const discard = () => dispatch({ type: "load", steps: saved ?? [] });
  return {
    steps,
    dispatch,
    issues,
    dirty,
    canEdit: saved !== null,
    save,
    discard,
    conflictProps: cs.props,
  };
}
