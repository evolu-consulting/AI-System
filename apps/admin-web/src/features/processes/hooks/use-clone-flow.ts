// CR-105 · UX: luồng Nhân bản — mở hộp thoại, gọi Hub với {key sinh từ tên, name}; trùng ký hiệu ⇒ thử `-2`, `-3`… rồi báo lỗi.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import type { CloneSource } from "../components/library/CloneDialog";
import { errorCode, processErrorSpec } from "../lib/errors";
import { slugKey } from "../lib/library-list";
import { cloneDef, useLibraryRefresh } from "../library-api";

const ATTEMPTS = 8;

export function useCloneFlow(onCloned: (id: string) => void) {
  const { t } = useTranslation();
  const refresh = useLibraryRefresh();
  const [src, setSrc] = useState<CloneSource | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (name: string) => {
    if (!src) return;
    setPending(true);
    setError(null);
    try {
      for (let n = 1; n <= ATTEMPTS; n++) {
        try {
          const res = await cloneDef(src.id, { key: slugKey(name, n), name });
          notifySuccess(t("process.admin.library.clone.done"));
          void refresh();
          setSrc(null);
          onCloned(res.id);
          return;
        } catch (err) {
          if (errorCode(err) !== "PROCESS_KEY_TAKEN" || n === ATTEMPTS) throw err;
        }
      }
    } catch (err) {
      const s = processErrorSpec(err);
      setError(t(s.key, s.params));
    } finally {
      setPending(false);
    }
  };
  return {
    src,
    pending,
    error,
    open: (s: CloneSource) => {
      setError(null);
      setSrc(s);
    },
    close: () => setSrc(null),
    submit,
  };
}
