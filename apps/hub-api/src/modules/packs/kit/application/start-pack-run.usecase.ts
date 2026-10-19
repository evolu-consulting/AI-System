// N2-FR-01 · N2-D04 · N2-D07 · plan N2 §2: khuôn khởi chạy run quy trình từ API gói + gắn `run_id` vào bản ghi gói.
// Thứ tự: (1) tx gói kiểm bản ghi (có, cùng tenant, chưa có run) → (2) engine mở run (tx hub, COMMIT, CHƯA kick) → (3) tx gói
// gắn có điều kiện (`run_id is null`) → (4) kick. (3) không gắn được / lỗi ⇒ huỷ run bù rồi trả `has_run` / ném lại. Không giữ
// hai khoá cùng lúc (tx hub COMMIT trước tx gói). Lớp 2: chỉ cổng.

import type { PackRunCaller, PackRunRequest, PackRunsBridge } from "./pack-runs.ports";
import type { PackUow, PackWho } from "./ports";

export type PackRunHooks<R> = {
  /** Bản ghi đích: không thấy (kể cả tenant khác) ⇒ `not_found`; đã gắn run ⇒ `has_run`. */
  check(r: R): Promise<"ok" | "not_found" | "has_run">;
  /** `update … set run_id = $run where id and tenant_id and run_id is null` — false ⇒ bị chiếm trước (đua). */
  attach(r: R, runId: string): Promise<boolean>;
};

export type StartPackRunResult =
  | { kind: "ok"; runId: string }
  | { kind: "engine_off" | "not_found" | "has_run" };

export type StartPackRunDeps<R> = {
  bridge: PackRunsBridge;
  uow: PackUow<R>;
  /** Lỗi kick/huỷ bù không chặn kết quả (vòng quét P-d nhặt run chưa kick) — chỉ ghi log. */
  warn: (msg: string, meta: Record<string, unknown>) => void;
};

export async function startPackRun<R>(
  d: StartPackRunDeps<R>,
  u: PackRunCaller,
  req: PackRunRequest,
  hooks: PackRunHooks<R>,
): Promise<StartPackRunResult> {
  const port = d.bridge.port;
  if (!port) return { kind: "engine_off" };
  const who: PackWho = { tenantId: u.tenantId, userId: u.userId };
  const pre = await d.uow.tenant(who, (r) => hooks.check(r));
  if (pre !== "ok") return { kind: pre };
  const { runId, kick } = await port.start(u, req);
  let attached = false;
  try {
    attached = await d.uow.tenant(who, (r) => hooks.attach(r, runId));
  } finally {
    if (!attached)
      await port.cancel(u, runId).catch(() => d.warn("pack-run-cancel-failed", { run_id: runId }));
  }
  if (!attached) return { kind: "has_run" };
  await kick().catch(() => d.warn("pack-run-kick-failed", { run_id: runId }));
  return { kind: "ok", runId };
}
