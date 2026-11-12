// CR-139 · Q13 · `GET /pack/contracts/org` (hub-api): phòng ban + trưởng phòng + thành viên, chỉ đọc, chỉ nội bộ.
import type { ContractsOrg } from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";

export const orgChartKey = ["contracts", "org-chart"] as const;
export const fetchOrgChart = (signal?: AbortSignal): Promise<ContractsOrg> =>
  api<ContractsOrg>("/pack/contracts/org", { signal });
