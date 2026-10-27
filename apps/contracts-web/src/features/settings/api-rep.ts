// REP-v3-ui · V2-E · gọi API cấu hình uy tín (`/pack/contracts/reputation/config*`): đọc, thử tính (không ghi), lưu từng phần đã đổi.
// Chỉ dùng khi `engine = v2e` (HD8: ghi trả 410 — `PUT /scoring/:role` thay thế, xem `ScoringPane`).
import type { RepPreviewIn } from "@ai/contracts";
import { api } from "@ai/web-kit/http";
import { cellBody, jobTypesBody, type RepChanged } from "./lib/rep-data";
import type { CellKey, RepConfigFull, RepData } from "./lib/rep-types";

const P = "/pack/contracts/reputation";
export const repKeys = { config: ["settings", "rep", "config"] as const };

export const fetchRepFull = (signal?: AbortSignal) => api<RepConfigFull>(`${P}/config`, { signal });

export type RepPreviewOut = {
  total: number;
  changes: {
    party: string;
    name: string;
    role: string;
    old: number | null;
    new: number | null;
    old_level: string;
    new_level: string;
  }[];
};
export const previewRep = (body: RepPreviewIn, signal?: AbortSignal) =>
  api<RepPreviewOut>(`${P}/config/preview`, { method: "POST", body, signal });

const cellPath = (k: CellKey) => `${P}/config/cells/${k.replace(":", "/")}`;

/** Lưu đúng các phần đã đổi, tuần tự (ô lỗi dừng ngay, phần đã lưu giữ nguyên; người dùng sửa rồi Lưu tiếp). */
export async function saveRepChanged(d: RepData, ch: RepChanged): Promise<void> {
  for (const k of ch.cells) await api(cellPath(k), { method: "PUT", body: cellBody(d.cells[k]) });
  if (ch.settings) await api(`${P}/config/settings`, { method: "PUT", body: d.repSettings });
  if (ch.jobTypes)
    await api(`${P}/config/job-types`, { method: "PUT", body: jobTypesBody(d.jobTypes) });
}
