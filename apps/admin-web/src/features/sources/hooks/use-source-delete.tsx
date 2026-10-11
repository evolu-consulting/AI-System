// ADM-FR-68 · PB-R08 · xoá nguồn. Dòng có `used_by` ⇒ lấy bản mới (version + used_by) rồi gọi DELETE để server trả refs
// (409 SOURCE_IN_USE) và mở BlockedDialog; không dùng ⇒ ConfirmDialog nhẹ. 409 lúc xác nhận (used_by cũ) cũng chuyển sang BlockedDialog.
import type { SourceView } from "@ai/contracts/hub-admin";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { deleteSource, fetchSource, useInvalidateSources } from "../api";
import { type DeleteTarget, SourceDeleteDialogs } from "../components/SourceDeleteDialogs";
import { hasCode, refsFromDetails, sourceErrorKey } from "../lib/errors";

/** Xoá thật; trả refs nếu bị chặn (409 SOURCE_IN_USE), `null` nếu đã xoá. Lỗi khác ném lại. */
async function tryDelete(key: string, version: number, tenantId: string | undefined) {
  try {
    await deleteSource(key, version, tenantId);
    return null;
  } catch (err) {
    if (err instanceof ApiError && hasCode(err, "SOURCE_IN_USE"))
      return refsFromDetails(err.details);
    throw err;
  }
}

/** Nguồn đã đổi / không còn: hộp xác nhận nên đóng thay vì giữ mở. */
const isStale = (err: unknown): boolean =>
  hasCode(err, "VERSION_CONFLICT") || hasCode(err, "SOURCE_NOT_FOUND");

function useFail() {
  const tr = useTr();
  return useCallback(
    (err: unknown) => {
      if (hasCode(err, "UNAUTHORIZED")) return; // modal phiên hết hạn xử lý
      notifyError(
        tr(hasCode(err, "VERSION_CONFLICT") ? "errors.versionConflict" : sourceErrorKey(err)),
      );
    },
    [tr],
  );
}

type SetTarget = (t: DeleteTarget | null) => void;

/** `true` = đã xoá (toast + làm tươi); `false` = bị chặn (đã mở BlockedDialog). */
function useAttempt(tenantId: string | undefined, setTarget: SetTarget) {
  const { t } = useTranslation();
  const invalidate = useInvalidateSources();
  return useCallback(
    async (key: string, version: number): Promise<boolean> => {
      const refs = await tryDelete(key, version, tenantId);
      if (refs) {
        setTarget({ key, version, refs, blocked: true });
        return false;
      }
      notifySuccess(t("process.sources.toast.deleted", { key }));
      void invalidate();
      return true;
    },
    [tenantId, t, invalidate, setTarget],
  );
}

export function useSourceDelete(tenantId: string | undefined) {
  const fail = useFail();
  const invalidate = useInvalidateSources();
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const attempt = useAttempt(tenantId, setTarget);

  const request = useCallback(
    async (s: SourceView) => {
      try {
        const fresh = s.used_by.length > 0 ? await fetchSource(s.key, tenantId) : s;
        if (fresh.used_by.length > 0) await attempt(fresh.key, fresh.version);
        else setTarget({ key: fresh.key, version: fresh.version, refs: [], blocked: false });
      } catch (err) {
        fail(err);
        void invalidate();
      }
    },
    [tenantId, attempt, fail, invalidate],
  );

  const close = () => setTarget(null);
  const confirm = async () => {
    if (!target) return;
    try {
      if (await attempt(target.key, target.version)) close();
    } catch (err) {
      fail(err);
      if (!isStale(err)) throw err; // giữ hộp thoại mở
      void invalidate();
      close();
    }
  };

  return {
    request,
    dialogs: <SourceDeleteDialogs target={target} onClose={close} onConfirm={confirm} />,
  };
}
