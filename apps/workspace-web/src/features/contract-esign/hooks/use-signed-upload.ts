// CR-141 · «Tải lên bản đã ký» của bước Ký hợp đồng: trạng thái (chờ + được tải + duyệt thay) và thao tác tải. Xong ⇒ làm mới ký số, HĐ, hồ sơ.
import { ApiError } from "@ai/web-kit/http";
import { toast } from "@ai/web-kit/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { approvalKey } from "~/features/contract-approval/api";
import { recordKey } from "~/features/contract-approval/api-record";
import { contractKey } from "~/features/contract-review/api";
import { esignKey, fetchSignedUpload, signedUploadKey, uploadSigned } from "../api";
import { isUploadOverride, showSignedUpload, uploadErrKey } from "../lib/signed-upload-view";

export function useSignedUpload(id: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: signedUploadKey(id),
    queryFn: ({ signal }) => fetchSignedUpload(id, signal),
    retry: false,
    staleTime: 15_000,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (file: File): Promise<boolean> => {
    setBusy(true);
    setErr(null);
    try {
      await uploadSigned(id, file);
      toast(t("contracts.esign.upload.done"));
      await Promise.all(
        [signedUploadKey(id), esignKey(id), contractKey(id), recordKey(id), approvalKey(id)].map(
          (queryKey) => qc.invalidateQueries({ queryKey }),
        ),
      );
      return true;
    } catch (e) {
      setErr(t(uploadErrKey(e instanceof ApiError ? e.code : null)));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return {
    show: showSignedUpload(q.data),
    override: isUploadOverride(q.data),
    busy,
    err,
    upload,
  };
}
