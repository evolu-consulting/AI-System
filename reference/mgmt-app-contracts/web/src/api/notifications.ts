import { useQuery } from "@tanstack/react-query";
import { api, send } from "./client";

/** The bell: contract reminders and "Hẹn nhắc" delivered at their time (api: routes/notifications.py). */
export type Notice = { id: string; title: string; body: string; link: string | null; contract_id: string | null;
  created_at: string; read_at: string | null };

export const useNotices = () =>
  useQuery({ queryKey: ["notifications"], queryFn: () => api<Notice[]>("/notifications"), refetchInterval: 60_000 });
export const readNotice = (id: string) => api(`/notifications/${id}/read`, send({}));
export const readAll = () => api("/notifications/read-all", send({}));
