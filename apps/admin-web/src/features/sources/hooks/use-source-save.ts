// ADM-FR-68 · FS4 · lưu nguồn: POST (mới) / PUT kèm `version` (409 ⇒ ConflictDialog). Lỗi server → ô (key/url/…) hoặc `alert` trong drawer,
// luôn là CÂU TĨNH theo mã (không in `message` server). Hub chưa gửi `details.current` cho VERSION_CONFLICT ⇒ tự lấy bản mới để dựng hộp xung đột.
import type { SourceUpdateRequest, SourceView } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { createSource, fetchSource, updateSource, useInvalidateSources } from "../api";
import { classifySaveError } from "../lib/errors";
import {
  type SourceFormErrors,
  type SourceFormMode,
  type SourceFormValues,
  toConfig,
  toCreateRequest,
} from "../lib/schemas";

type Args = {
  mode: SourceFormMode;
  source: SourceView | undefined;
  tenantId: string | undefined;
  tenants: { id: string; key: string }[];
  isPlatform: boolean;
  onDone: () => void;
  /** Bản mới do người dùng chọn "Dùng bản mới" ở hộp xung đột. */
  onReload: () => void;
};

type EditBody = Omit<SourceUpdateRequest, "version">;

/** 409 VERSION_CONFLICT chưa có `details.current` ⇒ lấy bản mới để ConflictDialog có dữ liệu so sánh. */
async function withConflictDetails(run: () => Promise<SourceView>, key: string, tenantId?: string) {
  try {
    return await run();
  } catch (err) {
    const noCurrent = !(err as { details?: { current?: unknown } }).details?.current;
    if (err instanceof ApiError && err.code === "VERSION_CONFLICT" && noCurrent) {
      const cur = await fetchSource(key, tenantId).catch(() => null);
      if (cur)
        throw new ApiError(err.status, err.code, err.message, {
          current: cur,
          updated_at: cur.updated_at,
        });
    }
    throw err;
  }
}

/** Trạng thái phản hồi của drawer: lỗi theo ô, `alert` chung, toast khi xong. */
function useSaveFeedback(a: Args, keyName: string) {
  const { t } = useTranslation();
  const tr = useTr();
  const invalidate = useInvalidateSources();
  const [errors, setErrors] = useState<SourceFormErrors>({});
  const [alertKey, setAlertKey] = useState<string | null>(null);

  const onFail = (err: unknown, formKey = keyName) => {
    const f = classifySaveError(err, formKey);
    if (f.type === "ignore") return;
    if (f.type === "alert") return setAlertKey(f.key);
    if (f.type === "field") return setErrors({ [f.field]: tr(f.key, f.params) });
    notifyError(tr("process.sources.apiError.SOURCE_NOT_FOUND"));
    void invalidate();
    a.onDone();
  };
  const saved = (res: SourceView, created: boolean) => {
    const key = created ? "process.sources.toast.created" : "process.sources.toast.saved";
    notifySuccess(t(key, { key: res.key }));
    void invalidate();
    a.onDone();
  };
  const reset = () => {
    setErrors({});
    setAlertKey(null);
  };
  return { errors, alertKey, onFail, saved, reset };
}

export function useSourceSave(a: Args) {
  const invalidate = useInvalidateSources();
  const [pending, setPending] = useState(false);
  const keyName = a.source?.key ?? "";
  const fb = useSaveFeedback(a, keyName);

  const cs = useConflictSave<EditBody, SourceView>({
    entity: "source",
    mutate: ({ version, ...body }) =>
      withConflictDetails(
        () => updateSource(keyName, { ...body, version }, a.tenantId),
        keyName,
        a.tenantId,
      ),
    onSaved: (res) => fb.saved(res, false),
    onFail: (e) => fb.onFail(e),
    onReload: () => {
      void invalidate();
      a.onReload();
    },
  });

  const submit = async (v: SourceFormValues) => {
    fb.reset();
    setPending(true);
    try {
      if (a.mode === "new") {
        const tenantId = a.isPlatform ? a.tenants.find((x) => x.key === v.tenant)?.id : undefined;
        fb.saved(await createSource(toCreateRequest(v, tenantId)), true);
      } else if (a.source) {
        await cs.save({ config: toConfig(v), description: v.description.trim() }, a.source.version);
      }
    } catch (err) {
      fb.onFail(err, v.key.trim().toLowerCase());
    } finally {
      setPending(false);
    }
  };
  return { submit, pending, errors: fb.errors, alertKey: fb.alertKey, conflictProps: cs.props };
}
