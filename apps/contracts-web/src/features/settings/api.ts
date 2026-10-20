// V2-L · gọi API cài đặt: công ty (`/company`), uy tín v2 (`/reputation/config*`), điểm kinh doanh (`/business/config*`).
import type {
  BizConfig,
  BizConfigOut,
  BizPreviewIn,
  BizScore,
  CompanyIn,
  CompanyOut,
  RepPreviewIn,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";
import { type Changed, cellBody, jobTypesBody } from "./lib/data";
import type { CellKey, RepConfigOut, SettingsData } from "./lib/types";

const P = "/pack/contracts";
export const settingsKeys = {
  company: ["settings", "company"] as const,
  rep: ["settings", "rep"] as const,
  biz: ["settings", "biz"] as const,
};

export const fetchCompany = (signal?: AbortSignal) => api<CompanyOut>(`${P}/company`, { signal });
export const fetchRepConfig = (signal?: AbortSignal) =>
  api<RepConfigOut>(`${P}/reputation/config`, { signal });
export const fetchBizConfig = (signal?: AbortSignal) =>
  api<BizConfigOut>(`${P}/business/config`, { signal });

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
  api<RepPreviewOut>(`${P}/reputation/config/preview`, { method: "POST", body, signal });
export const previewBiz = (body: BizPreviewIn, signal?: AbortSignal) =>
  api<BizScore>(`${P}/business/config/preview`, { method: "POST", body, signal });

const cellPath = (k: CellKey) => `${P}/reputation/config/cells/${k.replace(":", "/")}`;

/** Lưu đúng các phần đã đổi, tuần tự (ô lỗi dừng ngay, phần đã lưu giữ nguyên; người dùng sửa rồi Lưu tiếp). */
export async function saveChanged(d: SettingsData, ch: Changed): Promise<void> {
  if (ch.company)
    await api<CompanyOut>(`${P}/company`, { method: "PUT", body: d.company satisfies CompanyIn });
  for (const k of ch.cells) await api(cellPath(k), { method: "PUT", body: cellBody(d.cells[k]) });
  if (ch.settings)
    await api(`${P}/reputation/config/settings`, { method: "PUT", body: d.repSettings });
  if (ch.jobTypes)
    await api(`${P}/reputation/config/job-types`, {
      method: "PUT",
      body: jobTypesBody(d.jobTypes),
    });
  if (ch.biz) await api(`${P}/business/config`, { method: "PUT", body: d.biz satisfies BizConfig });
}
