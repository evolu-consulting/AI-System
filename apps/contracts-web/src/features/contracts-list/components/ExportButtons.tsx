// Gap #8 · nút xuất danh sách (Excel / CSV) theo đúng bộ lọc đang hiện. Tải về (Bearer qua web-kit, do trang truyền vào `run`) rồi lưu
// bằng thẻ `<a download>`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PopMenu } from "~/components/shared/pop-menu";
import { toast } from "~/components/shared/toast";
import type { ExportFile } from "../lib/export-file";

export type ExportFormat = "xlsx" | "csv";
// ux-excel E1: MỘT nút "Xuất" + menu (Excel / CSV).
const EXPORT_FORMATS: ExportFormat[] = ["xlsx", "csv"];

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportButtons({ run }: { run: (f: ExportFormat) => Promise<ExportFile> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  async function go(f: ExportFormat) {
    setBusy(f);
    try {
      const r = await run(f);
      save(r.blob, r.filename);
      toast(
        r.truncated
          ? t("contracts.list.export.truncated", { total: r.total.toLocaleString("vi-VN") })
          : t("contracts.list.export.done"),
      );
    } catch {
      toast(t("contracts.list.export.failed"));
    } finally {
      setBusy(null);
    }
  }
  return (
    <PopMenu
      ariaLabel={t("contracts.list.export.menu")}
      triggerClass="btn btn-outline btn-sm"
      disabled={busy !== null}
      busy={busy !== null}
      trigger={
        <>
          <DownloadIcon />
          {busy !== null ? t("contracts.list.export.busy") : t("contracts.list.export.menu")}
        </>
      }
      items={EXPORT_FORMATS.map((f) => ({
        key: f,
        label: t(`contracts.list.export.${f}`),
        onSelect: () => void go(f),
      }))}
    />
  );
}

const DownloadIcon = () => (
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
    <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
  </svg>
);
