// ADM-FR-60 · banner mất kết nối (`status`) dùng onlineManager của TanStack Query; có mạng lại → "Đã kết nối lại" 3 giây.
import { onlineManager } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

const RECONNECTED_MS = 3000;

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  );
}

export function ConnectionBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  const wasOffline = useRef(false);
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setReconnected(false);
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setReconnected(true);
    const id = setTimeout(() => setReconnected(false), RECONNECTED_MS);
    return () => clearTimeout(id);
  }, [online]);

  if (online && !reconnected) return null;
  return (
    <output
      className={
        online
          ? "mb-4 block rounded-md bg-success-bg px-4 py-2 text-label text-success"
          : "mb-4 block rounded-md bg-warning-bg px-4 py-2 text-label text-warning"
      }
    >
      {online ? t("state.online") : t("state.offline.banner")}
    </output>
  );
}
