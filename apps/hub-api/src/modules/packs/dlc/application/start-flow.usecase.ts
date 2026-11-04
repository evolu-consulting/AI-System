// dlc-engine · mở một lượt DLC (tool `dlc-start` của dlc-agent trong Chat, hoặc route gói): chọn dây chuyền (theo ticket: lỗi ⇒
// Bug Fix, còn lại Enhancement; hoặc người chỉ định), lấy quy trình của khe: agent gọi chỉ định def thư viện (`dlc_flows`) ⇒ def
// đó; không ⇒ của tenant (gán ⇒ mặc định ⇒ bản xuất bản; chưa có ⇒ sơ đồ mặc định), phân giải Group duyệt theo mã, `ensureDef` vào def tenant `dlc-<mode>`, mở run GẮN hội thoại Chat
// (bước duyệt + câu hỏi của agent hiện trong hội thoại), ghi `dlc.flows` rồi mới kick. Lớp 2.
import type {
  PackRunCaller,
  PackRunsBridge,
  PackRunsPort,
} from "../../kit/application/pack-runs.ports";
import type { ResolvedSlot } from "../../kit/application/slot.ports";
import {
  compileDlcStages,
  DLC_MODES,
  DLC_SLOTS,
  type DlcMode,
  defaultDlcBody,
  dlcBodyOf,
  dlcGroupKeys,
  dlcProcessDef,
  dlcProcessKey,
  resolveDlcStages,
  validateDlcBody,
} from "../domain/dlc-flow.rules";
import { projectKeyOf, type Ticket } from "../domain/dlc-prompts.rules";
import type { AgentFlows, DlcOwnRepos, WorkspacePort } from "./ports";
import { fail } from "./step-context";

export type StartDeps = {
  runs: PackRunsBridge;
  ws: WorkspacePort;
  uow: {
    tenant<T>(
      who: { tenantId: string; userId: string },
      fn: (r: DlcOwnRepos) => Promise<T>,
    ): Promise<T>;
  };
  warn(msg: string, meta: Record<string, unknown>): void;
};
export type StartRequest = {
  mode?: DlcMode | null;
  project?: string | null;
  ticketId?: string | null;
  requirement?: string | null;
  conversationId: string | null;
  /** dlc-agent-flows · quy trình agent gọi `dlc-start` chỉ định; dây chuyền không có ⇒ quy trình của tenant. */
  agentFlows?: AgentFlows | null;
};
export type StartResult = { run_id: string; mode: DlcMode; project: string; process: string };

type TicketRow = Ticket & { project_key?: string | null; app?: string };

/** Dây chuyền + project: người chỉ định thắng; không ⇒ theo ticket; không ticket ⇒ Enhancement. */
function pickTarget(r: StartRequest, t: TicketRow | null): { mode: DlcMode; project: string } {
  const mode = r.mode ?? (t?.kind === "bug" ? "bug-fix" : "enhancement");
  if (!(DLC_MODES as readonly string[]).includes(mode)) fail(`dây chuyền không hợp lệ: ${mode}`);
  const raw = r.project?.trim() || t?.project_key || t?.app || "";
  if (!raw) fail("thiếu project (ticket không gắn project — hỏi người dùng project nào)");
  return { mode, project: projectKeyOf(raw) };
}

/** dlc-agent-flows · nguồn quy trình của khe: agent chỉ định def thư viện ⇒ đúng def đó (bản xuất bản; không còn ⇒ lỗi rõ, KHÔNG
 *  âm thầm rơi về tenant); không chỉ định ⇒ quy trình của tenant (gán ⇒ mặc định ⇒ xuất bản; null ⇒ sơ đồ mặc định). */
export async function slotSourceOf(
  port: Pick<PackRunsPort, "resolveSlot" | "resolveSlotDef">,
  tenantId: string,
  mode: DlcMode,
  agentFlows?: AgentFlows | null,
): Promise<ResolvedSlot | null> {
  const slot = DLC_SLOTS[mode].key;
  const key = agentFlows?.[mode];
  if (!key) return port.resolveSlot ? port.resolveSlot(tenantId, slot) : null;
  const r = port.resolveSlotDef ? await port.resolveSlotDef(slot, key) : null;
  return (
    r ??
    fail(
      `quy trình "${key}" agent chọn cho ${DLC_SLOTS[mode].label} không còn bản xuất bản (sửa agent ở Agent Forge)`,
    )
  );
}

/** Stage của khe (agent chỉ định / tenant / sơ đồ mặc định) đã phân giải Group; trả cả nguồn để ghi vào lượt. */
async function stagesFor(d: StartDeps, tenantId: string, mode: DlcMode, flows?: AgentFlows | null) {
  const port = d.runs.port ?? fail("engine quy trình đang tắt");
  const r = await slotSourceOf(port, tenantId, mode, flows);
  const body = r ? dlcBodyOf(r.slotBody) : defaultDlcBody(mode);
  if (!body || validateDlcBody(body).length)
    fail(`quy trình ${DLC_SLOTS[mode].label} của công ty không hợp lệ`);
  const valid = body as NonNullable<typeof body>;
  const keys = dlcGroupKeys(valid);
  const ids = keys.length ? await port.groupIdsOf(tenantId, keys) : new Map<string, string>();
  const stages = resolveDlcStages(compileDlcStages(valid, mode), ids);
  if (!stages)
    fail(`công ty thiếu Group duyệt: ${keys.filter((k) => !ids.has(k)).join(", ")} (bật gói DLC)`);
  return { port, stages: stages as NonNullable<typeof stages>, source: r };
}

export function startDlcFlow(d: StartDeps) {
  return async (u: PackRunCaller, r: StartRequest): Promise<StartResult> => {
    const ticket = r.ticketId ? ((await d.ws.ticket(r.ticketId)) as TicketRow | null) : null;
    if (r.ticketId && !ticket) fail(`không thấy ticket ${r.ticketId}`);
    const { mode, project } = pickTarget(r, ticket);
    const { port, stages, source } = await stagesFor(d, u.tenantId, mode, r.agentFlows);
    const def = dlcProcessDef(mode, stages);
    const sourceRef = port.sourceRefOf(def);
    await port.ensureDef(u, dlcProcessKey(mode), def, { sourceRef });
    const input = (r.requirement?.trim() || ticket?.name || project).slice(0, 8000);
    const { runId, kick } = await port.start(u, {
      process_key: dlcProcessKey(mode),
      input,
      ...(r.conversationId ? { conversation_id: r.conversationId } : {}),
      ...(source
        ? {
            slot: {
              source_ref: sourceRef,
              process_name: source.name,
              rel_version: source.relVersion,
            },
          }
        : {}),
    });
    const flow = {
      id: runId,
      mode,
      project,
      ticketId: r.ticketId ?? null,
      conversationId: r.conversationId,
      startedBy: u.userId,
      requirement: (r.requirement ?? "").slice(0, 200_000),
      state: {},
    };
    try {
      await d.uow.tenant(u, (x) => x.flows.insert(flow));
    } catch (e) {
      await port.cancel(u, runId).catch(() => d.warn("dlc-start-cancel-failed", { run_id: runId }));
      throw e;
    }
    await kick().catch(() => d.warn("dlc-start-kick-failed", { run_id: runId }));
    return { run_id: runId, mode, project, process: DLC_SLOTS[mode].label };
  };
}
