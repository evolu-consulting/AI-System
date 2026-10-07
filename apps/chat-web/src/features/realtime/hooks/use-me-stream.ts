// HUB-FR-100 · mount trong `AppShell`: mở `/me/stream` khi đã đăng nhập, đóng khi unmount. `online` / tab hiện lại khi
// `down` → nối ngay. Tab ẩn vẫn giữ kết nối (badge tab nền đúng).
import { useEffect } from "react";
import { realtimeStore } from "../realtime-store";
import { meStreamDriver } from "../runtime";

export function useMeStream(): void {
  useEffect(() => {
    meStreamDriver.start();
    const nudge = () => {
      if (realtimeStore.get().phase === "down" || realtimeStore.get().phase === "reconnecting")
        meStreamDriver.retry();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") nudge();
    };
    window.addEventListener("online", nudge);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", nudge);
      document.removeEventListener("visibilitychange", onVisible);
      meStreamDriver.stop();
    };
  }, []);
}
