// UC-02 · nhắc xám trên composer khi `run.started.quota.state = over`; ✕ ẩn tới hết phiên (sessionStorage).
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const KEY = "chat:quota-dismissed";

function wasDismissed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function QuotaNotice({ over }: { over: boolean }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(wasDismissed);
  if (!over || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      // bỏ qua: chỉ mất việc nhớ trong phiên
    }
  };
  return (
    <div className="mb-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span className="flex-1">{t("composer.quotaOver")}</span>
      <button
        type="button"
        aria-label={t("composer.quotaDismiss")}
        onClick={dismiss}
        className="rounded p-1 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
