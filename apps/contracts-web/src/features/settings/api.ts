// V2-L · gọi API cài đặt: công ty (`/company`), điểm kinh doanh (`/business/config*`). Điểm uy tín: `ScoringPane` (`/scoring/:role`, U3).
import type {
  BizConfig,
  BizConfigOut,
  BizPreviewIn,
  BizScore,
  CompanyIn,
  CompanyOut,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";
import type { Changed } from "./lib/data";
import type { SettingsData } from "./lib/types";

const P = "/pack/contracts";
export const settingsKeys = {
  company: ["settings", "company"] as const,
  biz: ["settings", "biz"] as const,
};

export const fetchCompany = (signal?: AbortSignal) => api<CompanyOut>(`${P}/company`, { signal });
export const fetchBizConfig = (signal?: AbortSignal) =>
  api<BizConfigOut>(`${P}/business/config`, { signal });

export const previewBiz = (body: BizPreviewIn, signal?: AbortSignal) =>
  api<BizScore>(`${P}/business/config/preview`, { method: "POST", body, signal });

/** Lưu đúng các phần đã đổi, tuần tự (phần lỗi dừng ngay, phần đã lưu giữ nguyên; người dùng sửa rồi Lưu tiếp). */
export async function saveChanged(d: SettingsData, ch: Changed): Promise<void> {
  if (ch.company)
    await api<CompanyOut>(`${P}/company`, { method: "PUT", body: d.company satisfies CompanyIn });
  if (ch.biz) await api(`${P}/business/config`, { method: "PUT", body: d.biz satisfies BizConfig });
}
