// WRK-FR-03 · HUB-FR-91 · hạ tầng ca delta phía Hub (QW-A2, test-plan H2b §5, cases §2 A100–A123): gửi tin, phát chuỗi
// `job.delta` theo nhịp, chờ/khẳng định SSE `delta` trước kết quả job, đọc trace `run_steps.detail`. Không chứa `it(...)`.
// Bổ sung `_h2b.ts` (QW-A1) — tách file riêng để `_h2b.ts` không phình. Ngữ nghĩa delta phía Hub kiểm bằng XADD tay
// (`ScriptRuntime3`, L4); end-to-end Runtime ở stack (QW-P).
import { expect } from "bun:test";
import type { DeltaKind, OrchestratorDecision } from "@ai/contracts/hub";
import { type Json, type Sql, waitFor } from "../H1/_fixtures";
import { type HubX, insertConv, runIdOf, type Sse, type SseEv, send } from "../H1/_hub";
import type { Job } from "../H1/_runtime";
import type { ScriptRuntime3 } from "./_h2b";

export type Run = { s: Sse; runId: string; conv: string; flowId: string };

/** E12 vào hội thoại mới (hoặc `conv`) của `who`; 200 SSE bắt buộc. */
export async function startRun(
  hub: HubX,
  sql: Sql,
  token: string,
  o: { who: "lan" | "hoa"; content: string; conv?: string },
): Promise<Run> {
  const conv = o.conv ?? (await insertConv(sql, o.who, crypto.randomUUID()));
  const s = await send(hub, token, conv, o.content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv, flowId: s.headers.get("x-flow-id") ?? "" };
}

export const isDelta = (e: SseEv): boolean => e.event === "delta";
export const deltasOf = (s: Sse): SseEv[] => s.events.filter(isDelta);
export const answer = (text: string): OrchestratorDecision => ({ decision: "answer", text });

/** Phát lần lượt `parts` dạng `job.delta{kind}`; `gapMs` > 0 → cách nhau (nhịp Runtime gom 100 ms). */
export async function streamParts(
  rt: ScriptRuntime3,
  job: Job,
  kind: DeltaKind,
  parts: readonly string[],
  gapMs = 0,
): Promise<void> {
  for (const [i, p] of parts.entries()) {
    if (i > 0 && gapMs > 0) await Bun.sleep(gapMs);
    await rt.delta(job, kind, p);
  }
}

/** Đã có ≥ `n` SSE `delta` trong `ms` (Hub chuyển tiếp trước khi job có kết quả). */
export async function expectDeltas(s: Sse, n = 1, ms = 3_000): Promise<void> {
  const ok = await waitFor(
    async () => deltasOf(s).length,
    (c) => c >= n,
    ms,
  );
  expect(ok).toBeGreaterThanOrEqual(n);
}

/** Không có SSE `delta` nào xuất hiện trong `ms` (kind không nhận / job không được stream). */
export async function expectNoDelta(s: Sse, ms = 800): Promise<void> {
  expect(await s.until(isDelta, ms)).toBeUndefined();
}

/** Vị trí sự kiện đầu thoả `pred` trong SSE (−1 nếu không có). */
export const indexOf = (s: Sse, pred: (e: SseEv) => boolean): number => s.events.findIndex(pred);

/** `step_id` SSE (`s<n>`) của step `type` thứ `nth` (0-based) theo `run_steps.seq`. */
export async function stepIdOf(sql: Sql, runId: string, type: string, nth = 0): Promise<string> {
  const rows = await sql<{ seq: number }[]>`select seq from hub.run_steps
    where run_id = ${runId} and type = ${type} order by seq`;
  return `s${rows[nth]?.seq ?? -1}`;
}

/** `step.finished` của step `stepId` có trong SSE sau sự kiện `delta` đầu tiên (delta đến khi step còn mở). */
export function expectDeltaBeforeStepEnd(s: Sse, stepId: string): void {
  const d = indexOf(s, isDelta);
  const f = indexOf(s, (e) => e.event === "step.finished" && e.data?.step_id === stepId);
  expect(d).toBeGreaterThanOrEqual(0);
  expect(f === -1 || d < f).toBe(true);
}

/** `run_steps.detail` của step `type` thứ `nth`. */
export async function stepDetail(sql: Sql, runId: string, type: string, nth = 0): Promise<Json> {
  const rows = await sql<{ detail: Json }[]>`select detail from hub.run_steps
    where run_id = ${runId} and type = ${type} order by seq`;
  return rows[nth]?.detail ?? null;
}

/** Số job vai `role` của run. */
export async function jobCount(sql: Sql, runId: string, role: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.jobs
    where run_id = ${runId} and payload->'agent'->>'role' = ${role}`;
  return r?.n ?? 0;
}

/** Payload thô của mọi job trong run (sắp tạo). */
export async function payloadsOf(sql: Sql, runId: string): Promise<Json[]> {
  const rows = await sql<{ payload: Json }[]>`select payload from hub.jobs where run_id = ${runId}
    order by created_at, id`;
  return rows.map((r) => r.payload);
}

/** Nửa cặp surrogate lẻ (cắt sai giữa emoji). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const hasLoneSurrogate = (t: string): boolean => LONE_SURROGATE.test(t);

/** Mọi `delta` ≤ 40 đơn vị UTF-16 và không surrogate lẻ (H1-R09, T13). */
export function expectDeltaShape(s: Sse): void {
  for (const e of deltasOf(s)) {
    const t = String(e.data?.text ?? "");
    expect(t.length).toBeGreaterThan(0);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(hasLoneSurrogate(t)).toBe(false);
  }
}

/** Thời điểm (ms, đồng hồ test) `cond` đúng lần đầu — poll 5 ms; hết `ms` → +∞. */
export async function arrival(cond: () => boolean, ms: number): Promise<number> {
  const end = Date.now() + ms;
  for (;;) {
    if (cond()) return Date.now();
    if (Date.now() > end) return Number.POSITIVE_INFINITY;
    await Bun.sleep(5);
  }
}

/** Trung vị / p95 (mẫu đã sắp). */
export function quantile(xs: readonly number[], q: number): number {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.ceil(q * a.length) - 1)] ?? Number.POSITIVE_INFINITY;
}
