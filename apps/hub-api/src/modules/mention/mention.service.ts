// HUB-FR-91 · HUB-BR-18 · H2b-R02–R05, R09 · chuẩn bị run từ tin có tag `@` (plan §5.1 bước 1, plan-errors §1). Kiểm
// quyền trên AU (`visibleAgents(accessInput(...))`) của ảnh cấu hình hiện hành; ném `AGENT_NOT_FOUND`/`CMD_MISSING_ARG`
// **trước** khi tạo run (không ghi gì). Thứ tự: `empty_tag` → tag sai đầu tiên → nội dung rỗng.
import type { Responder } from "@ai/contracts/chat";
import type { AuthUser } from "../../lib/auth.middleware";
import { appError, isAppError } from "../../lib/errors";
import { type AccessSubject, accessInput, visibleAgents } from "../agents/agent-access.rules";
import type { AgentConfig, ConfigSnapshot } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";
import { firstUnknownTag, type MentionLocale, responderOf, suggestAgents } from "./mention.rules";
import type { Routed } from "./mention-parse.rules";

/** Một tag hợp lệ → run `direct` (R06, R10): agent + `responder` chốt lúc tạo run, `content` = nội dung sau tag (R04). */
export type DirectRunStart = {
  kind: "direct";
  agent: AgentConfig;
  responder: Responder;
  content: string;
};
/** ≥ 2 tag hợp lệ → Orchestrator thu hẹp `onlyKeys` (R09). */
export type OrchestratedRunStart = {
  kind: "orchestrated";
  content: string;
  onlyKeys: ReadonlySet<string>;
};
export type MentionPlan = DirectRunStart | OrchestratedRunStart;
export type MentionRouted = Extract<Routed, { kind: "mention" | "mention_error" }>;

export type PrepareMentionInput = {
  routed: MentionRouted;
  snapshot: ConfigSnapshot;
  who: AccessSubject;
  locale: MentionLocale;
};

const agentNotFound = (suggestions: string[]) => appError("AGENT_NOT_FOUND", { suggestions });

/** §5.1 bước 1 (`mention`): tag so lower với key AU; agent ngoài AU (Orchestrator, runtime khác, tắt…) = không tồn tại. */
export function prepareMention(i: PrepareMentionInput): MentionPlan {
  const { routed, snapshot } = i;
  if (routed.kind === "mention_error") throw agentNotFound([]);
  const au = visibleAgents(accessInput(snapshot, i.who));
  const keys = au.map((a) => a.key);
  const unknown = firstUnknownTag(routed.tags, new Set(keys));
  if (unknown !== null) throw agentNotFound(suggestAgents(unknown, keys));
  if (routed.content === "")
    throw appError("CMD_MISSING_ARG", { missing: ["content"], invalid: [] });
  const [only] = routed.tags;
  const agent = routed.tags.length === 1 && snapshot.agents.find((a) => a.key === only);
  if (agent) {
    return {
      kind: "direct",
      agent,
      responder: responderOf(agent, i.locale),
      content: routed.content,
    };
  }
  return { kind: "orchestrated", content: routed.content, onlyKeys: new Set(routed.tags) };
}

export type MentionConfig = Pick<ConfigCache, "snapshot" | "user" | "poll">;

export class MentionService {
  constructor(private readonly config: MentionConfig) {}

  async #prepare(u: AuthUser, routed: MentionRouted): Promise<MentionPlan> {
    const [snapshot, user] = await Promise.all([
      this.config.snapshot(),
      this.config.user(u.userId),
    ]);
    const who = { tenantId: u.tenantId, userId: u.userId, groupIds: user?.groupIds ?? new Set() };
    return prepareMention({ routed, snapshot, who, locale: user?.locale ?? "vi" });
  }

  /** Tag lạ: so phiên bản cấu hình (1 query) — Admin vừa đổi mà NOTIFY chưa tới thì nạp lại rồi kiểm lần nữa (như H2a). */
  async prepare(u: AuthUser, routed: MentionRouted): Promise<MentionPlan> {
    try {
      return await this.#prepare(u, routed);
    } catch (err) {
      if (routed.kind === "mention_error" || !isAppError(err, "AGENT_NOT_FOUND")) throw err;
      await this.config.poll();
      return this.#prepare(u, routed);
    }
  }
}
