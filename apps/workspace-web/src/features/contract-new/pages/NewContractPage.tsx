// CR-097 K3a · HD-FR-26 (ngừng): /contracts/new không còn form nhập tay — HĐ phải tải lên từ văn bản đã ký. Hiện câu giải thích + nút Upload
// (cùng hàng đợi như danh sách). Form nhập tay giữ ở `ManualContractForm` cho việc Giao dịch sau này.

import { AttachDropzone } from "@ai/web-kit/ui/AttachDropzone";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAttachPickLabels } from "~/components/shared/AttachField";
import { PageHead, Panel } from "~/components/shared/layout";
import { QueueExtractDialog } from "~/features/contracts-list/components/ExtractDialog";
import { UploadPanel } from "~/features/contracts-list/components/UploadPanel";
import { useUploadQueue } from "~/features/contracts-list/hooks/use-upload-queue";
import { UPLOAD_ACCEPT, UPLOAD_MAX_BYTES } from "~/features/contracts-list/lib/upload-queue";
import { useMe } from "~/features/pack-state/hooks/use-me";

export function NewContractPage() {
  const { t } = useTranslation();
  const { write } = useMe();
  const nav = useNavigate();
  const pick = useAttachPickLabels();
  const queue = useUploadQueue((id) => void nav({ to: "/contracts/c/$id", params: { id } }));
  return (
    <div className="text-base leading-[1.55]">
      <PageHead
        crumb={
          <Link to="/contracts/list" className="hover:underline">
            {t("contracts.review.back")}
          </Link>
        }
        title={t("contracts.cform.newTitle")}
      />
      <QueueExtractDialog items={queue.items} />
      <UploadPanel items={queue.items} onRetry={queue.retry} onClose={queue.clear} />
      <Panel>
        <div className="flex flex-col items-start gap-3 px-5 py-6" data-testid="new-upload-only">
          <p className="text-[15px] font-medium">{t("contracts.lock.uploadOnly")}</p>
          <p className="text-sm text-dim">{t("contracts.lock.uploadOnlyHint")}</p>
          {write && (
            <div className="w-full">
              <AttachDropzone
                labels={pick}
                accept={UPLOAD_ACCEPT}
                maxBytes={UPLOAD_MAX_BYTES}
                check={false}
                inputTestId="new-upload-input"
                onFiles={(fs) => queue.enqueue(fs)}
              />
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
