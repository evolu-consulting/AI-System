// N2-D08 · security L3: gói chỉ đọc kết quả (gồm lý do Từ chối) của run mà BẢN GHI CỦA GÓI đang giữ — id run đọc trong tx gói
// (RLS + tenant), rồi mới hỏi engine. Không cho gói hỏi run id tuỳ ý. Lớp 2: chỉ cổng.
import type { PackRunCaller, PackRunOutcome, PackRunsBridge } from "./pack-runs.ports";
import type { PackUow } from "./ports";

export type OwnedRunOutcome =
  | { kind: "ok"; outcome: PackRunOutcome }
  | { kind: "engine_off" | "not_found" | "no_run" };

export async function ownedRunOutcome<R>(
  d: { bridge: PackRunsBridge; uow: PackUow<R> },
  u: PackRunCaller,
  /** `run_id` bản ghi giữ: không thấy bản ghi ⇒ undefined; chưa có run ⇒ null. */
  runOf: (r: R) => Promise<string | null | undefined>,
): Promise<OwnedRunOutcome> {
  const port = d.bridge.port;
  if (!port) return { kind: "engine_off" };
  const runId = await d.uow.tenant({ tenantId: u.tenantId, userId: u.userId }, runOf);
  if (runId === undefined) return { kind: "not_found" };
  if (runId === null) return { kind: "no_run" };
  const [o] = await port.outcomes(u, [runId]);
  return o ? { kind: "ok", outcome: o } : { kind: "no_run" };
}
