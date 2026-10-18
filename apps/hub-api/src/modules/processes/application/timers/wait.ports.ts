// HUB-FR-144 · PD-R13/R15 · TZ-R04 · plan §4.6 · port lớp 2 riêng của stage `wait_until` (T8a) — CHỈ kiểu, không `Tx`.
// Adapter gắn tx + `tenantId` của hàng run đã khoá (`adapters/timers/tenant-tz.repo.ts`, `adapters/timers/wait.repo.ts`).

/** TZ-R04 · múi giờ IANA của tenant (`admin.tenants.timezone`, lọc `id = tenantId`); không hàng ⇒ mặc định + log warn. */
export type TenantTzReader = { read(): Promise<string> };

/** PD-R13 · nguồn ngày gốc đã giải (field: chỉ số stage nguồn theo snapshot). */
export type WaitSource =
  | { kind: "input"; key: string }
  | { kind: "field"; stageIdx: number; field: string };

/** PD-R13/R15 · đọc ngày gốc + ghi stage chờ — mọi câu lọc `tenant_id`; người gọi đã khoá run (thứ tự run → stage → timer). */
export type WaitRepo = {
  /** Ngày gốc (input `date` của run / `fields->>field` của output hiện hành stage nguồn; vắng ⇒ null) + `expires_at`. */
  loadBase(
    runId: string,
    src: WaitSource,
  ): Promise<{ base: string | null; expiresAt: Date | null }>;
  /** Stage ⇒ `waiting_timer`, `current_run_id = NULL`, `started_at = coalesce(started_at, now)`. */
  markWaiting(stageRunId: string, now: Date): Promise<void>;
};
