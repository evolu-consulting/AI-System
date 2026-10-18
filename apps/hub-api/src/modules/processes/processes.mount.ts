// HUB-FR-104…117 · D15 · mount module quy trình khi cờ `HUB_PROCESS_ENGINE=on` (plan §8 hàng 0b, plan-contract §7.1):
// route mọi PF (file của từng PF, mount sẵn ⇒ PF không sửa file này), ThreadPoster + vòng nền, seam N3. Cờ tắt ⇒ `app.ts`
// không gọi ⇒ mọi route quy trình 404, `!` là chữ thường.
import { PROCESS_RUNS_PER_TENANT } from "@ai/contracts/chat";
import type { Env, Hono } from "hono";
import { KhWriter } from "../kh/kh.writer";
import type { RoomProcessSender } from "../rooms/messages/messages.service";
import type { ResolveBridge } from "../sources/resolve.bridge";
import { createHubUow, systemOnly, tenantOnly } from "./adapters/hub-uow";
import { makeOutboxPublisher } from "./adapters/outbox";
import { asksRoutes } from "./asks/asks.routes";
import { type Clock, clockOf } from "./core/clock";
import type { ProcessHandles } from "./core/handles";
import type { ProcessBgDeps, ProcessDeps, ProcessStartPort, StageLauncher } from "./core/ports";
import { ThreadPoster } from "./core/thread-poster";
import { defsRoutes } from "./defs/defs.routes";
import { gatesRoutes } from "./gates/gates.routes";
import { inboxRoutes } from "./notify/inbox.routes";
import { createNotifier } from "./notify/notifier";
import { remindOnce } from "./notify/reminder";
import { conversationStart } from "./runs/conversation-start";
import { createStageLauncher } from "./runs/launcher";
import { applyResolveReport } from "./runs/resolve-apply";
import { roomStart } from "./runs/room-start";
import { processRunsRoutes } from "./runs/runs.routes";
import { startProcessSweeper, sweepOnce } from "./runs/sweeps";
import { warmBackgroundPool } from "./runs/warm-pool";
import { usageRoutes } from "./usage/usage.routes";

/** Gốc route quy trình cần JWT (`app.ts` gắn `requireAuth`; `/me/*` đã có ở X2a). */
export const PROCESS_PROTECTED_PREFIXES = [
  "/processes",
  "/process-runs",
  "/review-tasks",
  "/process-defs",
  "/agent-teams",
] as const;

/** Seam test (plan-contract §7.1): vắng ⇒ hành vi chạy thật. */
export type ProcessSeams = {
  processRunsPerTenant?: number;
  stageLauncher?: StageLauncher;
  now?: Clock;
  /** false ⇒ không chạy vòng nền (test gọi `*Once` qua handles). */
  processLoops?: boolean;
  onProcessHandles?: (h: ProcessHandles) => void;
  /** PB-R05 · cầu nối từ `/sources-resolved`; engine gắn `onReport` để ghim/kick/needs_decision. */
  resolveBridge?: ResolveBridge;
  /** P-c2 · C13 · endpoint GitHub (seam ưu tiên env `HUB_GITHUB_*`); vắng ⇒ driver Áp không mở PR. */
  github?: { apiUrl: string; webHost: string };
};
export type ProcessMountDeps = Omit<
  ProcessDeps,
  "now" | "runsPerTenant" | "launcher" | "notifier" | "postThread" | "start" | "uow" | "ctx"
> &
  ProcessSeams;
/** Điểm nối vào route có sẵn: `!` ở phòng (X2a/X2b) + Hỏi AI (C1). */
export type ProcessMounted = { roomSender: RoomProcessSender; conversationStart: ProcessStartPort };

export function mountProcesses<E extends Env>(app: Hono<E>, m: ProcessMountDeps): ProcessMounted {
  const poster = new ThreadPoster(m);
  // K1 · HUB-FR-133 · bộ gửi `kh_writes` (cùng `KhRuntime` với `kh-query`); vắng KH ⇒ không chạy.
  const khWriter = m.kh && new KhWriter({ db: m.db, rt: m.kh, log: m.log });
  const now = clockOf(m.now);
  const notifier = createNotifier();
  const postThread = (runId: string) => poster.post(runId);
  // P-d · CA-R06/R07 · UoW bốn lớp: outbox phát SAU COMMIT qua Redis/launcher/ThreadPoster (launcher dựng sau ⇒ gọi trễ).
  const publish = makeOutboxPublisher({
    redis: m.redis,
    log: m.log,
    postThread,
    launcher: { kick: (runId) => d.launcher.kick(runId) },
  });
  // T6c · tách cổng: route/use case HTTP chỉ thấy `tenant`; vòng nền + handles nhận `sysUow` (object riêng, không lộ qua `d`).
  const uow = createHubUow(m.db, { clock: { now }, publish, notifier });
  const base: Omit<ProcessDeps, "start" | "launcher"> = {
    ...m,
    now,
    runsPerTenant: m.processRunsPerTenant ?? PROCESS_RUNS_PER_TENANT,
    notifier,
    postThread,
    uow: tenantOnly(uow),
    ctx: { clock: { now }, ids: { newId: () => crypto.randomUUID() }, log: m.log },
  };
  // Launcher thật nhận `ProcessDeps` (RunService/runner) để tạo `hub.runs` stage; test có thể thay `stageLauncher` giả.
  const launcher = m.stageLauncher ?? createStageLauncher(base);
  const core: Omit<ProcessDeps, "start"> = { ...base, launcher };
  const d: ProcessDeps = { ...core, start: conversationStart(core) };
  // PB-R05 · nhận report resolve từ module nguồn (đã mount trước): ghim `pinned_sources`/`needs_decision` + kick.
  if (m.resolveBridge) m.resolveBridge.onReport = (r) => applyResolveReport(d, r);
  for (const r of [
    processRunsRoutes,
    gatesRoutes,
    asksRoutes,
    inboxRoutes,
    usageRoutes,
    defsRoutes,
  ])
    app.route("/", r(d));
  const bg: ProcessBgDeps = { ...d, sysUow: systemOnly(uow) };
  m.onProcessHandles?.({
    sweepOnce: () => sweepOnce(bg),
    remindOnce: () => remindOnce(bg),
    postThreadOnce: () => poster.postThreadOnce(),
    kick: (runId) => d.launcher.kick(runId),
    khWriteOnce: () => khWriter?.writeOnce() ?? Promise.resolve(0),
  });
  // CR-093 · làm nóng pool cho câu lô vòng nền (chạy nền, không chặn mount; cả khi test tắt vòng — handles dùng chung pool).
  void warmBackgroundPool(bg);
  if (m.processLoops !== false) {
    poster.start(m.signal);
    khWriter?.start(m.signal);
    // B2 · PF1: vòng nền `sweepOnce` thật (mở PR stage Áp, interrupted, resolveTimeouts, requeueOrphans). Khi
    // `processLoops:false` (test), bỏ qua — test gọi qua `onProcessHandles.sweepOnce`.
    startProcessSweeper(bg, { signal: m.signal });
  }
  return { roomSender: roomStart(d), conversationStart: d.start };
}
