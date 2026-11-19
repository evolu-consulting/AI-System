// CR-180: đầu trang danh sách HĐ. Điện thoại: PageHeader (nút chính «Tải hợp đồng lên» rộng hết; Xuất / Thêm giao dịch vào «⋯»).
// Desktop: PageHead cũ (nút «Xuất» + «Thêm giao dịch» + «Tải hợp đồng lên» cạnh tiêu đề).
import { Button } from "@ai/web-kit/ui/kit/button";
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { Link, useNavigate } from "@tanstack/react-router";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { PageHead } from "~/components/shared/layout";
import type { ExportFile } from "../lib/export-file";
import { UPLOAD_ACCEPT } from "../lib/upload-queue";
import { EXPORT_FORMATS, ExportButtons, type ExportFormat } from "./ExportButtons";

type Props = {
  write: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onPick: (files: File[]) => void;
  exporter: { go: (f: ExportFormat) => Promise<void>; busy: ExportFormat | null };
  run: (f: ExportFormat) => Promise<ExportFile>;
  /** CR-188 · mở hộp «Kiểm tra tệp» (dò mọi giấy tờ đã ký của công ty). */
  onVerify: () => void;
};

export function ListHeader({ write, fileRef, onPick, exporter, run, onVerify }: Props) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const title = t("contracts.contractsPage.title");
  const upload = (size?: "sm") => (
    <Button variant="primary" {...(size ? { size } : {})} onClick={() => fileRef.current?.click()}>
      <UploadIcon />
      {t("contracts.list.add")}
    </Button>
  );
  return (
    <>
      {write && (
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept={UPLOAD_ACCEPT}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (picked.length) onPick(picked);
          }}
        />
      )}
      <div className="sm:hidden">
        <PageHeader
          className="mb-4"
          title={title}
          {...(write ? { primary: upload() } : {})}
          actions={[
            { label: t("contracts.verify.button"), onSelect: onVerify },
            ...EXPORT_FORMATS.map((f) => ({
              label: t(`contracts.list.export.${f}`),
              disabled: exporter.busy !== null,
              onSelect: () => void exporter.go(f),
            })),
            ...(write
              ? [
                  {
                    label: t("contracts.doclist.addDeal"),
                    onSelect: () => void nav({ to: "/contracts/c/new", search: { type: "deal" } }),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <div className="max-sm:hidden">
        <PageHead
          title={title}
          actions={
            <>
              <Button variant="quiet" size="sm" data-testid="verify-open" onClick={onVerify}>
                {t("contracts.verify.button")}
              </Button>
              <ExportButtons run={run} />
              {write && (
                <>
                  <Link
                    to="/contracts/c/new"
                    search={{ type: "deal" }}
                    className="btn btn-quiet btn-sm"
                    data-testid="add-deal"
                  >
                    {t("contracts.doclist.addDeal")}
                  </Link>
                  {upload("sm")}
                </>
              )}
            </>
          }
        />
      </div>
    </>
  );
}

const UploadIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </svg>
);
