// dlc-deploy-url · link mở app vừa deploy của một lượt DLC đã xong (thẻ khung nhập): đọc `app_url` từ tiến độ lượt; chưa deploy /
// lỗi / không quyền ⇒ ẩn. Mở tab mới để người dùng kiểm app ngay.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchDlcProgress } from "../api";

export function DlcAppLink({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["process", "dlc-progress", runId],
    queryFn: ({ signal }) => fetchDlcProgress(runId, signal),
    retry: false,
    staleTime: 60_000,
  });
  const url = q.data?.app_url;
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm font-medium text-primary underline underline-offset-2"
    >
      {t("process.run.dlcProgress.openApp", { url })}
    </a>
  );
}
