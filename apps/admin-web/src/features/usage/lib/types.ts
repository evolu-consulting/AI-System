// ADM-FR-42 · kiểu dùng chung của feature usage (component không import api.ts).
import type { UsageReportPlatform, UsageReportTenant } from "@ai/contracts";

export type UsageReport = UsageReportPlatform | UsageReportTenant;
export type UsageParams = { tenantId?: string; from: string; to: string };
