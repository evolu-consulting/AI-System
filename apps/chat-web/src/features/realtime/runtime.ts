// HUB-FR-100 · ghép `MeStreamDriver` với I/O thật: fetch `/me/stream`, đồng hồ, QueryClient. Đăng xuất/hết phiên → dừng.
import { queryClient } from "~/app/query-client";
import { session } from "~/lib/auth/session";
import { openMeStream } from "./api";
import { createEventRouter, type RoomLostReason } from "./event-router";
import { readRawSse } from "./lib/read-raw-sse";
import { MeStreamDriver } from "./me-stream-driver";
import { realtimeStore } from "./realtime-store";

type RoomLostListener = (roomId: string, reason: RoomLostReason) => void;
const lostListeners = new Set<RoomLostListener>();

/** F6: trang phòng đăng ký để điều hướng + toast khi mất phòng đang mở. Trả hàm huỷ đăng ký. */
export function onRoomLost(l: RoomLostListener): () => void {
  lostListeners.add(l);
  return () => lostListeners.delete(l);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

const route = createEventRouter({
  client: queryClient,
  myId: () => session.getState().me?.id ?? null,
  onRoomLost: (id, reason) => {
    for (const l of lostListeners) l(id, reason);
  },
});

export const meStreamDriver = new MeStreamDriver(realtimeStore, {
  open: openMeStream,
  read: readRawSse,
  sleep,
  setTimer: (cb, ms) => {
    const t = setTimeout(cb, ms);
    return () => clearTimeout(t);
  },
  onEvent: route,
});

session.on("cleared", () => meStreamDriver.stop());
session.on("expired", () => meStreamDriver.stop());
