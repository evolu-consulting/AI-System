// CR-121 · cr121-c3a-overview-api · cổng đọc của "Tổng quan admin platform" (lớp 2): kiểu dòng gom + giao diện nguồn dữ liệu.
// `adapters/overview.source.ts` hiện thực (6 câu SQL một tx scope system + file host); `adapters/overview.wire.ts` nối vào service.
import type { OpsHostStatus } from "@ai/contracts/hub-admin";

export type Window = { now: Date; since1h: Date; since24: Date; since7: Date };

export type Bucket = { k: number };

export type RunsRow = {
  started: (Bucket & { n: number; c: number })[];
  finished: (Bucket & { ended: number; failed: number; done: number; p95_s: number | null })[];
  hourly: { h: number; ok: number; err: number }[];
  running: number;
  needs_decision: number;
  failed_24h: number;
  stuck: number;
};

export type DifyRow = {
  errs: (Bucket & { n: number })[];
  calls_1h: number;
  errs_1h: number;
  errs_24h: number;
  failing_tools: number;
  top: { id: string; name: string; errors: number } | null;
};

export type QuotaRow = {
  tenants_with_limit: number;
  limit_usd: number;
  used_usd: number;
  near: number;
  daily: (Bucket & { usd: number })[];
};

export type CompaniesRow = { total: number; active_7d: number };

export type InfraRow = {
  queued: number;
  oldest_wait_s: number | null;
  timer_overdue_s: number | null;
  slow_query_ms: number | null;
  connections: number;
  max_connections: number;
  size_bytes: number;
};

export type CoverageRow = {
  status: string;
  value: {
    gap_count?: number;
    gaps?: { tenant: string }[];
    unrouted?: string[];
    broken?: string[];
  } | null;
};

export type OverviewReadResult = {
  runs: RunsRow;
  dify: DifyRow;
  quota: QuotaRow;
  cos: CompaniesRow;
  infra: InfraRow;
  /** Thời gian câu Q5 (ms) — "ping" DB hiện trên thẻ. */
  pingMs: number;
  cov: CoverageRow | null;
};

export type HostStatusFile =
  | { kind: "missing" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; data: OpsHostStatus };

export interface OverviewSource {
  /** SÁU câu theo tập trong MỘT tx scope system (số câu cố định, Luật 4c). */
  read(
    win: Window,
    stuckBefore: Date,
    month: { from: Date; to: Date },
    quotaPct: number,
  ): Promise<OverviewReadResult>;
  /** File `host.json` do host ghi (không ném lỗi). */
  hostStatus(): Promise<HostStatusFile>;
}
