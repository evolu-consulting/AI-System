import { useQuery } from "@tanstack/react-query";
import { api, send } from "./client";

/** "Hẹn nhắc": a reminder at a date and time for the signed-in person (api/app/ledger/followups.py). */
export type Followup = { id: string; subject_kind: string; subject_id: string; at: string; title: string; note: string | null;
  link: string; status: "pending" | "sent" | "done" };

export const useFollowups = () => useQuery({ queryKey: ["followups"], queryFn: () => api<Followup[]>("/followups") });

export const remindAbout = (subject_kind: string, subject_id: string, at: string, note?: string) =>
  api<Followup>("/followups", send({ subject_kind, subject_id, at, note }));

/** "2026-11-15T09:00:00+07:00" → "09:00 15/11". */
export const atLabel = (iso: string) => `${iso.slice(11, 16)} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** A date `days` from `from` (or today) as yyyy-mm-dd, for the date fields' suggestions. */
export const dayPlus = (days: number, from?: string) => {
  const d = from ? new Date(`${from}T00:00:00`) : new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
