// HUB-FR-104…117 · D15 · mount module quy trình khi cờ `HUB_PROCESS_ENGINE=on` (plan §8 hàng 0b, plan-contract §7.1):
// route mọi PF (file của từng PF, mount sẵn ⇒ PF không sửa file này), ThreadPoster + vòng nền, seam N3. Cờ tắt ⇒ `app.ts`
// không gọi ⇒ mọi route quy trình 404, `!` là chữ thường.
import type { Env, Hono, MiddlewareHandler } from "hono";
import { requireAdminRole } from "../../lib/admin-role.middleware";
import { KhWriter } from "../kh/kh.writer";
import type { WorkflowInvoker } from "../mcp/adapters/workflow-invoker";
import type { PackRunsBridge } from "../packs/kit/application/pack-runs.ports";
import type { PackToolCatalog } from "../packs/kit/application/pack-tools.ports";
import type { RoomProcessSender } from "../rooms/messages/messages.service";
import type { ResolveBridge } from "../sources/resolve.bridge";
import { DrainTracker } from "./adapters/drain";
import { createHubUow, systemOnly, type ToolRepoFactory, tenantOnly } from "./adapters/hub-uow";
import { makeOutboxPublisher } from "./adapters/outbox";
import { mcpToolInvoker } from "./adapters/tools/mcp-tool-invoker";
import { toolDriverFactory } from "./adapters/tools/tool-driver";
import { toolStageRepo } from "./adapters/tools/tool-stage.repo";
import type { UnitOfWork } from "./application/ports";
import { asksRoutes } from "./asks/asks.routes";
import { type Clock, clockOf } from "./core/clock";
import type { ProcessHandles } from "./core/handles";
import type { ProcessBgDeps, ProcessDeps, ProcessStartPort, StageLauncher } from "./core/ports";
import { ThreadPoster } from "./core/thread-poster";
import { defsRoutes } from "./defs/defs.routes";
import { gatesRoutes } from "./gates/gates.routes";
import { libraryInternalRoutes } from "./library/library.internal.routes";
import { libraryRoutes } from "./library/library.routes";
import { previewRoutes } from "./library/preview.routes";
import { inboxRoutes } from "./notify/inbox.routes";
import { createNotifier } from "./notify/notifier";
import { remindOnce, startProcessReminder } from "./notify/reminder";
import { PROCESS_ROUTES_HEADER, type ProcessRoutesMode } from "./routes-mode";
import { conversationStart } from "./runs/conversation-start";
import { createStageLauncher } from "./runs/launcher";
import { packRunsOf } from "./runs/pack-runs";
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
  "/process-editor", // P-d1 · `GET /process-editor/context` (plan-contract §4)
  "/process-slots", // CR-105 · L2a · khe thư viện (platform_admin)
  "/tenants", // CR-105 · L2a · `/tenants/:tid/process-slots…` (platform_admin)
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
  /** P-d2 · D2-02 · pipeline gọi workflow dùng chung với `/mcp` (`app.ts` dựng một bản); vắng ⇒ stage tool `NOT_CONFIGURED`. */
  workflowInvoker?: WorkflowInvoker;
  /** N2-FR-01 · cầu khởi chạy run cho module gói (engine gắn `port` khi mount). */
  packRuns?: PackRunsBridge;
  /** N2-FR-03 · registry tool gói (stage `tool`, editor, luật lưu def). */
  packTools?: PackToolCatalog;
};
export type ProcessMountDeps = Omit<
  ProcessDeps,
  | "now"
  | "runsPerTenant"
  | "launcher"
  | "notifier"
  | "postThread"
  | "start"
  | "uow"
  | "ctx"
  | "toolDriver"
> &
  ProcessSeams & {
    /** CR-105 · L5 · `HUB_INTERNAL_TOKEN` cho `PUT /internal/tenants/:tid/process-slots/:slot` (vắng ⇒ 503). */
    internalToken?: string;
    /**
     * F1 (CR-095) · CR-103 · chế độ route công khai (`routes-mode.ts`): `off` ⇒ KHÔNG mount (`/process-runs`, `/processes`, …);
     * `admin` ⇒ chỉ defs/runs/gates/usage sau `requireAdminRole`; engine + vòng nền + cầu gói vẫn chạy. Vắng ⇒ `all`.
     */
    publicRoutes?: ProcessRoutesMode;
  };
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
  // P-d2 · D2-11 · repo stage `tool` cần `ProcessDeps` (dựng sau ⇒ gọi trễ qua closure).
  const tools: ToolRepoFactory = (tx, tenantId, o) => toolStageRepo(tx, tenantId, o, base);
  const uow = createHubUow(m.db, { clock: { now }, publish, notifier, tools });
  // T7 · Luật 4c · `handles.settled()`: đếm việc stage-driver đang xử lý kết quả job.
  const drain = new DrainTracker();
  const toolDriver = toolDriverOf(m, uow, now, drain);
  const base: Omit<ProcessDeps, "start" | "launcher"> = {
    ...m,
    now,
    drain,
    toolDriver,
    // N2-D11 · vắng seam ⇒ trần đọc theo tenant (`admin.tenants.process_runs_max`) lúc start.
    runsPerTenant: m.processRunsPerTenant,
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
  if (m.packRuns) m.packRuns.port = packRunsOf(d); // N2-FR-01
  mountRoutes(app, d, m.publicRoutes ?? "all");
  app.route("/internal", libraryInternalRoutes(d, m.internalToken)); // CR-105 · L5 · token dịch vụ, không JWT
  const bg: ProcessBgDeps = { ...d, sysUow: systemOnly(uow) };
  startBackground({ m, bg, poster, khWriter, drain });
  return { roomSender: roomStart(d), conversationStart: d.start };
}

/** Route admin-web cần (editor, lượt chạy + Token, duyệt/huỷ/quyết định). KHÔNG có asks + hộp việc `/me/*` (chat-web). */
const ADMIN_ROUTES = [processRunsRoutes, gatesRoutes, usageRoutes, defsRoutes, libraryRoutes];
const ALL_ROUTES = [
  processRunsRoutes,
  gatesRoutes,
  asksRoutes,
  inboxRoutes,
  usageRoutes,
  defsRoutes,
  libraryRoutes, // CR-105 · L2a
];

/** CR-103 · `admin`: chặn role ở GỐC mọi tiền tố quy trình (JWT role, không dựa `X-App` do client đặt) ⇒ member 403. */
function mountRoutes<E extends Env>(app: Hono<E>, d: ProcessDeps, mode: ProcessRoutesMode): void {
  if (mode === "off") return;
  if (mode === "admin") {
    const gate = requireAdminRole() as unknown as MiddlewareHandler<E>;
    for (const p of PROCESS_PROTECTED_PREFIXES) app.use(p, gate).use(`${p}/*`, gate);
    // fnr-fix-unfreeze · báo chế độ cho admin-web qua chính lời dò `GET /process-defs` (sau cổng role; không route mới).
    app.use("/process-defs", async (c, next) => {
      await next();
      c.header(PROCESS_ROUTES_HEADER, "admin");
    });
  }
  for (const r of mode === "admin" ? ADMIN_ROUTES : ALL_ROUTES) app.route("/", r(d));
  app.route("/", previewRoutes(d)); // CR-105 · L2b · xem trước đường đi quy trình thư viện (platform_admin)
}

/** P-d2 · D2-12/S11 · driver stage `tool` giữ cổng scope system trong closure; launcher chỉ nhận factory. */
function toolDriverOf(
  m: ProcessMountDeps,
  uow: UnitOfWork,
  now: Clock,
  drain: DrainTracker,
): ProcessDeps["toolDriver"] {
  return toolDriverFactory({
    uow: systemOnly(uow),
    invoker: mcpToolInvoker({ invoker: m.workflowInvoker, config: m.config, packs: m.packTools }),
    // m-2 · đồng hồ đơn điệu ở lớp ráp (adapter), không ở use case.
    clock: { now, monotonicMs: () => performance.now() },
    log: m.log,
    drain,
  });
}

/** Handles cho test + làm nóng pool + (khi bật) các vòng nền. */
function startBackground(o: {
  m: ProcessMountDeps;
  bg: ProcessBgDeps;
  poster: ThreadPoster;
  khWriter: KhWriter | undefined;
  drain: DrainTracker;
}): void {
  const { m, bg, poster, khWriter, drain } = o;
  m.onProcessHandles?.({
    sweepOnce: () => sweepOnce(bg),
    remindOnce: () => remindOnce(bg),
    postThreadOnce: () => poster.postThreadOnce(),
    kick: (runId) => bg.launcher.kick(runId),
    khWriteOnce: () => khWriter?.writeOnce() ?? Promise.resolve(0),
    settled: () => drain.settled(),
  });
  // CR-093 · làm nóng pool cho câu lô vòng nền (chạy nền, không chặn mount; cả khi test tắt vòng — handles dùng chung pool).
  void warmBackgroundPool(bg);
  if (m.processLoops === false) return;
  poster.start(m.signal);
  khWriter?.start(m.signal);
  // B2 · PF1: vòng nền `sweepOnce` thật (mở PR stage Áp, interrupted, resolveTimeouts, requeueOrphans). Khi
  // `processLoops:false` (test), bỏ qua — test gọi qua `onProcessHandles.sweepOnce`.
  startProcessSweeper(bg, { signal: m.signal });
  // D-PD10 · plan §5 · vòng nhắc + chuyển cấp 300 s (theo tập, `systemBatch`).
  startProcessReminder(bg, { signal: m.signal });
}
