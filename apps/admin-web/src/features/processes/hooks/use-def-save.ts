// ADM-FR-66 · CR-056 · P-a F5: lưu quy trình — validate client, POST (mới) / PUT kèm `version` (409 ⇒ ConflictDialog),
// lỗi Hub theo `paths` gắn vào ô và mở giai đoạn lỗi (plan-frontend-admin §1 "Validate").
import type { ProcessDef, ProcessDefInput } from "@ai/contracts/hub-admin";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { createDef, updateDef, useInvalidateDefs } from "../api";
import { toDraft, toInput, validateDraft } from "../lib/def-form";
import { errorCode, processErrorSpec, serverErrors, serverPaths, serverRules } from "../lib/errors";
import type { TeamSections } from "../lib/wait-form";
import type { DraftState } from "./use-draft";

type Args = {
  id: string | undefined;
  /** Vắng ở platform_admin ⇒ tạo mẫu (không gửi `tenant_id`). */
  tenantId: string | undefined;
  version: number;
  setVersion: (v: number) => void;
  d: DraftState;
  /** P-d1 · nhóm agent đã tải (mục từng thành viên) ⇒ luật `TEAM_SECTION_UNOWNED`; vắng ⇒ để Hub kiểm. */
  teams?: TeamSections;
};
const PATHED = new Set(["PROCESS_DEF_INVALID", "PROCESS_DEF_INCOMPLETE", "PROCESS_REF_INVALID"]);

/** Lỗi lưu → lỗi theo ô (key trùng, `paths`) hoặc toast. */
function useSaveFailure(d: DraftState) {
  const { t } = useTranslation();
  return (err: unknown) => {
    const code = errorCode(err);
    const paths = serverPaths(err);
    const key = `process.admin.apiError.${code}`;
    if (code === "PROCESS_KEY_TAKEN") return d.showErrors({ key });
    if (code && PATHED.has(code) && paths.length)
      return d.showErrors(serverErrors(code, paths, serverRules(err)));
    const spec = processErrorSpec(err);
    notifyError(t(spec.key, spec.params));
  };
}

/** Tạo xong: đợi bản nháp được đánh dấu "đã lưu" (UnsavedGuard) rồi mới chuyển sang trang sửa. */
function useRedirectAfterCreate(createdId: string | null, dirty: boolean) {
  const navigate = useNavigate();
  useEffect(() => {
    if (createdId && !dirty)
      void navigate({
        to: "/processes/$processId",
        params: { processId: createdId },
        replace: true,
      });
  }, [createdId, dirty, navigate]);
}

export function useDefSave({ id, tenantId, version, setVersion, d, teams }: Args) {
  const { t } = useTranslation();
  const invalidate = useInvalidateDefs();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const onFail = useSaveFailure(d);
  useRedirectAfterCreate(createdId, d.dirty);
  const saved = (res: ProcessDef) => {
    setVersion(res.version);
    d.markSaved();
    void invalidate();
  };
  const cs = useConflictSave<ProcessDefInput, ProcessDef>({
    entity: "process_def",
    mutate: ({ version: v, ...body }) => updateDef(id ?? "", { ...body, version: v }, tenantId),
    onSaved: saved,
    onFail,
    onReload: (cur) => {
      const def = cur as unknown as ProcessDef;
      d.load(toDraft(def));
      setVersion(def.version);
      void invalidate();
    },
  });
  const submit = async () => {
    const errors = validateDraft(d.draftRef.current, undefined, teams);
    d.showErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const body = toInput(d.draftRef.current);
    setPending(true);
    try {
      if (id !== undefined) await cs.save(body, version);
      else {
        const res = await createDef(body, tenantId);
        saved(res);
        notifySuccess(t("common.saved"));
        setCreatedId(res.id);
      }
    } catch (err) {
      onFail(err);
    } finally {
      setPending(false);
    }
  };
  return { submit, pending, conflictProps: cs.props };
}
