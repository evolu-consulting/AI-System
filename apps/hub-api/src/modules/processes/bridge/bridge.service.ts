// CR-122 · N2 · FLOW2-FR-26 · `POST /process-defs/bridge-suggest` — nghiệp vụ "Gợi ý cầu nối". KHÔNG lưu gì. Thứ tự: vai (người sửa flow:
// tenant_admin công ty mình / platform_admin) → bảng node theo tính năng công ty → cạnh có thật + có lệch (tất định, 0 lời gọi AI nếu đã
// khớp) → giới hạn tần suất → agent Hub `flow-bridge` (AI client chung: trần token + usage theo tenant) với hạn giờ → zod → kiểm lại bằng
// `flowEdgeIssues`. AI chỉ thấy tên/kiểu trường. Mọi lỗi AI ⇒ `ok: false` kèm lý do (không 5xx).
import { getAppManifest } from "@ai/contracts/app-manifest";
import {
  type BridgeSuggestRequest,
  type BridgeSuggestResponse,
  flowEdgeIssues,
  flowEdges,
  flowStageOutputs,
  resolveSteps,
} from "@ai/contracts/hub-admin";
import type { AgentCaller } from "../../../lib/ai-client/agent-call";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError, appError } from "../../../lib/errors";
import { validationError } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { paletteOf } from "../defs/node-features";
import {
  BRIDGE_NO,
  bridgePromptOf,
  eventFactsOf,
  parseBridgeReply,
  runInputsOf,
  verifyBridge,
} from "./bridge.rules";

export const BRIDGE_AGENT = "flow-bridge";
export const BRIDGE_FEATURE = "flow.bridge";
/** Hạn chờ AI mỗi lần (ms) và trần tần suất mỗi người (lần / cửa sổ). */
export const BRIDGE_TIMEOUT_MS = 30_000;
export const BRIDGE_RATE = { max: 10, windowMs: 60_000 } as const;

/** Cửa sổ trượt trong bộ nhớ theo khoá (người dùng) — đủ cho một instance; lưới chính vẫn là trần token theo tenant của AI client. */
export function rateGate(max: number, windowMs: number, now: () => number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const live = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (live.length >= max) {
      hits.set(key, live);
      return false;
    }
    live.push(t);
    hits.set(key, live);
    return true;
  };
}

/** Chỉ số hai stage của cạnh `from → to`; không phải một cạnh thật của flow ⇒ 400. */
function edgeIndexOf(
  stages: BridgeSuggestRequest["def"]["stages"],
  from: string,
  to: string,
): [number, number] {
  const f = stages.findIndex((s) => s.key === from);
  const t = stages.findIndex((s) => s.key === to);
  if (f < 0 || t < 0 || !flowEdges(stages).some(([a, b]) => a === f && b === t))
    throw validationError([
      { path: ["to"], code: "custom", message: "from → to is not an edge of this flow" },
    ]);
  return [f, t];
}

export type BridgeDeps = {
  config: ProcessDeps["config"];
  /** Vắng ⇒ AI chưa nối (mọi lời gợi ý `ok: false`). */
  agent?: Pick<AgentCaller, "call"> | undefined;
  now?: () => number;
  timeoutMs?: number;
};

export class BridgeService {
  readonly #gate;
  constructor(private readonly d: BridgeDeps) {
    this.#gate = rateGate(BRIDGE_RATE.max, BRIDGE_RATE.windowMs, d.now ?? Date.now);
  }

  /** `tenantId` = phạm vi đã chốt ở route (`defScopeOf`); null ⇒ platform_admin sửa Thư viện. */
  async suggest(
    u: AuthUser,
    tenantId: string | null,
    req: BridgeSuggestRequest,
  ): Promise<BridgeSuggestResponse> {
    if (u.role !== "tenant_admin" && u.role !== "platform_admin") throw appError("FORBIDDEN");
    if (u.role === "tenant_admin" && tenantId !== u.tenantId) throw appError("FORBIDDEN");
    const { def, from, to } = req;
    const [f, t] = edgeIndexOf(def.stages, from, to);
    const palette = await paletteOf(this.d.config, tenantId);
    const issue = flowEdgeIssues(def, palette).find((x) => x.from === from && x.to === to);
    if (!issue) return BRIDGE_NO.matched();
    if (!this.d.agent) return BRIDGE_NO.unavailable();
    this.#throttle(u);
    const toStage = def.stages[t];
    const facts = eventFactsOf(def, getAppManifest); // CR-122 E4b · khoá + kiểu dữ kiện của sự kiện mở flow
    const prompt = bridgePromptOf({
      facts,
      fromNode: def.stages[f]?.node ?? null,
      fromStep: resolveSteps(def.stages)[f], // CR-122 E4 · nguồn field của bước trước
      toNode: toStage?.node ?? null,
      fromOutputs: flowStageOutputs(def, palette)[f] ?? [],
      toInputs: palette.find((n) => n.key === toStage?.node)?.inputs ?? [],
      issue,
      runInputs: runInputsOf(def.inputs),
    });
    const text = await this.#ask(u, prompt);
    if (typeof text !== "string") return text;
    const reply = parseBridgeReply(text);
    if (!reply) return BRIDGE_NO.invalid();
    if (!reply.ok) return reply;
    return verifyBridge(reply, { def, from, to, palette, facts });
  }

  /** Quá tần suất ⇒ 429 (`Retry-After`); chỉ tính khi thật sự sắp gọi AI. */
  #throttle(u: AuthUser): void {
    if (this.#gate(`${u.tenantId}:${u.userId}`)) return;
    const e = new AppError("BRIDGE_RATE_LIMITED", 429, "Too many bridge suggestions");
    e.headers = { "Retry-After": String(Math.ceil(BRIDGE_RATE.windowMs / 1000)) };
    throw e;
  }

  /** Một lời gọi agent Hub; lỗi/hết hạn/hết trần ⇒ phản hồi `ok: false` (không ném). */
  async #ask(u: AuthUser, prompt: string): Promise<string | BridgeSuggestResponse> {
    try {
      const out = await this.d.agent?.call({
        tenantId: u.tenantId,
        userId: u.userId,
        agentKey: BRIDGE_AGENT,
        feature: BRIDGE_FEATURE,
        app: "flow",
        trigger: "manual",
        prompt,
        maxTokens: 800,
        signal: AbortSignal.timeout(this.d.timeoutMs ?? BRIDGE_TIMEOUT_MS),
      });
      if (!out) return BRIDGE_NO.unavailable();
      if (out.ok) return out.text;
      if (out.code === "CAP_EXCEEDED") return BRIDGE_NO.capped();
      return out.code === "UNAVAILABLE" || out.code === "DISABLED"
        ? BRIDGE_NO.unavailable()
        : BRIDGE_NO.failed();
    } catch {
      return BRIDGE_NO.failed();
    }
  }
}
