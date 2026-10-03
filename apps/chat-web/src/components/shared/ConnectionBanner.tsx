// CHAT-AC-28, 29 · banner kết nối: vàng "Đang kết nối lại…" (status) / đỏ "Không kết nối được máy chủ" + Thử lại (alert).
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

export type ConnectionKind = "reconnecting" | "down";

type Props = { kind: ConnectionKind; onRetry: () => void };

export function ConnectionBanner({ kind, onRetry }: Props) {
  const { t } = useTranslation();
  if (kind === "reconnecting") {
    return (
      <div
        role="status"
        className="flex shrink-0 items-center justify-center bg-warning-bg px-4 py-2 text-label text-warning"
      >
        {t("conn.reconnecting")}
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-center gap-3 bg-destructive px-4 py-2 text-label text-destructive-foreground"
    >
      <span>{t("conn.down")}</span>
      <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
        {t("conn.retry")}
      </Button>
    </div>
  );
}
