// HUB-FR-98, HUB-FR-100 · phòng đang mở bị mất (bị bớt / bị xoá) → về `/c/new` + toast (plan-frontend §2).
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { onRoomLost } from "~/features/realtime/runtime";

export function useRoomLost(roomId: string, name: string): void {
  const navigate = useNavigate();
  const { t } = useTranslation();
  useEffect(
    () =>
      onRoomLost((id, reason) => {
        if (id !== roomId) return;
        toast(t(reason === "deleted" ? "rooms.toast.gone" : "rooms.toast.kicked", { name }));
        void navigate({ to: "/c/new" });
      }),
    [roomId, name, navigate, t],
  );
}
