// CR-097 K3b · HD-FR-101: "Tải bản cập nhật" — chọn tệp văn bản ĐÃ KÝ ⇒ một POST ⇒ mở bản nháp v(n+1).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AttachField, fileToDraft } from "~/components/shared/AttachField";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ExtractDialog } from "~/features/contracts-list/components/ExtractDialog";
import { ApiError } from "~/lib/api-error";
import { uploadVersion } from "../hooks/use-versions-api";
import { versionErrorKey } from "../lib/versions";

export function UploadVersionPanel({
  contractId,
  open,
  onClose,
}: {
  contractId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const up = useMutation({
    mutationFn: (f: File) => uploadVersion(contractId, f),
    onSuccess: async (r) => {
      onClose();
      setFile(null);
      await qc.invalidateQueries();
      await nav({ to: "/contracts/c/$id", params: { id: r.id } });
    },
  });
  if (!open) return null;
  const err = up.error
    ? t(versionErrorKey(up.error instanceof ApiError ? up.error.code : undefined))
    : null;
  return (
    <>
      <ExtractDialog open={up.isPending} name={file?.name ?? ""} />
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          aria-label={t("contracts.versions.upload.title")}
          data-testid="upload-version"
          showCloseButton={false}
          className="sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>{t("contracts.versions.upload.title")}</DialogTitle>
            <DialogDescription className="text-sm text-dim">
              {t("contracts.versions.upload.hint")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm font-semibold text-soon" data-testid="upload-version-signed">
              {t("contracts.versions.upload.signedOnly")}
            </p>
            <AttachField
              multiple={false}
              accept=".pdf,.docx,.jpg,.jpeg,.png,.md"
              inputTestId="upload-version-file"
              items={file ? [fileToDraft(file)] : []}
              onFiles={(fs) => setFile(fs[0] ?? null)}
              onRemove={() => setFile(null)}
            />
            {err && (
              <p role="alert" data-testid="upload-version-error" className="text-sm text-late">
                {err}
              </p>
            )}
          </DialogBody>
          <DialogFooter className="flex-row justify-end">
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
              {t("contracts.versions.upload.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="upload-version-submit"
              disabled={!file || up.isPending}
              onClick={() => file && up.mutate(file)}
            >
              {t("contracts.versions.upload.submit")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
