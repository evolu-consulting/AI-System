// P-b · PF-S3 · PB-R05 · cầu nối late-bind giữa module nguồn (nhận `/sources-resolved`) và engine quy trình (ghim
// `pinned_sources` / `needs_decision` / kick). mountSources chạy TRƯỚC mountProcesses ⇒ dùng object chung, engine set
// `onReport` khi mount. Check-path (process_run_id null) KHÔNG qua bridge (settle waiters). [HUB-FR-122]
import type { SourcesResolvedRequest } from "@ai/contracts/hub-internal";

export type ResolveReport = {
  jobId: string;
  runId: string;
  tenantId: string;
  results: SourcesResolvedRequest["results"];
};

/** Engine quy trình gắn `onReport` lúc mount; vắng (engine tắt) ⇒ report run bị bỏ qua. */
export type ResolveBridge = { onReport?: (r: ResolveReport) => Promise<void> };
