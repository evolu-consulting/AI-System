// HUB-FR-98, HUB-FR-100 · phòng đang mở bị mất (bị bớt / bị xoá) → về `/c/new` + toast (plan-frontend §2).
// Tự xoá / tự rời: người thao tác tự điều hướng + toast riêng (`self-exit`) nên bỏ qua sự kiện dội lại.
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { onRoomLost } from "~/features/realtime/runtime";
import { roomToast } from "../lib/room-toast";
import { consumeSelfExit } from "../lib/self-exit";

export function useRoomLost(roomId: string, name: string): void {
  const navigate = useNavigate();
  const { t } = useTranslation();
  useEffect(
    () =>
      onRoomLost((id, reason) => {
        if (id !== roomId || consumeSelfExit(id)) return;
        roomToast(t(reason === "deleted" ? "rooms.toast.gone" : "rooms.toast.kicked", { name }));
        void navigate({ to: "/c/new" });
      }),
    [roomId, name, navigate, t],
  );
}
