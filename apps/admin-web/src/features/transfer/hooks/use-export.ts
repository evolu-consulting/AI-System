// ADM-FR-54 · trạng thái tab Export: chọn loại (mặc định tất cả), tên file, tải + toast.
import { TRANSFER_TYPES, type TransferType } from "@ai/contracts";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { useExportDownload, useExportMeta } from "../api";

export type AllState = boolean | "indeterminate";

export function useExport() {
  const { t } = useTranslation();
  const meta = useExportMeta();
  const download = useExportDownload();
  const [picked, setPicked] = useState<ReadonlySet<TransferType>>(() => new Set(TRANSFER_TYPES));

  const toggle = useCallback((type: TransferType, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(type);
      else next.delete(type);
      return next;
    });
  }, []);
  const toggleAll = useCallback((on: boolean) => {
    setPicked(on ? new Set(TRANSFER_TYPES) : new Set());
  }, []);

  const all: AllState =
    picked.size === TRANSFER_TYPES.length ? true : picked.size === 0 ? false : "indeterminate";
  const file = meta.data ? `config-v${meta.data.config_version}.yaml` : null;

  const submit = useCallback(() => {
    if (!file || picked.size === 0) return;
    const types = TRANSFER_TYPES.filter((x) => picked.has(x));
    download.mutate(
      { types, fallbackName: file },
      {
        onSuccess: (d) => notifySuccess(t("transfer.toast.downloaded", { file: d.filename })),
        onError: (e) => {
          const m = describeError(e);
          notifyError(t(m.key, m.params));
        },
      },
    );
  }, [download, file, picked, t]);

  return { meta, picked, all, file, toggle, toggleAll, submit, downloading: download.isPending };
}
