// C1-R01, C1-R02, C1-R09, CHAT-AC-05, 18–23 · `ChatStore` trong bộ nhớ của mock chat (plan C1 §2.3, §2.6, §3.1).
// Mọi truy vấn hội thoại lọc theo chủ (`user_id` = `sub`, `tenant_id` = `tid`); flow/tin chỉ tới được qua hội thoại
// đã qua kiểm sở hữu. Thời gian lưu ms; `clock()` tăng nghiêm ngặt để sắp xếp tất định.
import {
  type Ask,
  type Conversation,
  deriveTitle,
  type Flow,
  type Message,
  matchesQuery,
  type RunSummary,
} from "@ai/contracts/chat";

export type Owner = { userId: string; tenantId: string };
export type ConvRec = Owner & {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};
export type FlowRec = {
  id: string;
  conversationId: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  /** Run đang chạy (B4 đặt/xoá); khác null → E12 vào flow này trả 409 `FLOW_BUSY`. */
  activeRunId: string | null;
  /** id tin theo thứ tự thêm (= `created_at` tăng). */
  messageIds: string[];
};
export type MsgRec = { seq: number; message: Message };
export type AssistantInput = { content: string; runId: string; run: RunSummary; ask: Ask | null };
type NewMessage = Omit<Message, "id" | "conversation_id" | "flow_id">;

const iso = (ms: number) => new Date(ms).toISOString();
const cmpId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function isOwned(c: ConvRec, owner: Owner): boolean {
  return !c.deleted && c.userId === owner.userId && c.tenantId === owner.tenantId;
}

export class ChatStore {
  private readonly convs = new Map<string, ConvRec>();
  private readonly flows = new Map<string, FlowRec>();
  private readonly msgs = new Map<string, MsgRec>();
  private seq = 0;
  private last = 0;

  /** ms hiện tại, luôn > lần gọi trước (hai thao tác liền nhau không trùng `updated_at`). */
  clock(): number {
    this.last = Math.max(Date.now(), this.last + 1);
    return this.last;
  }

  /** Hội thoại còn sống của chủ, sắp `updated_at` giảm, hoà → `id` giảm; lọc `q` không dấu (`foldVi`). */
  listConversations(owner: Owner, q?: string): ConvRec[] {
    return [...this.convs.values()]
      .filter((c) => isOwned(c, owner) && matchesQuery(c.title, q))
      .sort((a, b) => b.updatedAt - a.updatedAt || cmpId(b.id, a.id));
  }

  /** null nếu không có, đã xoá, hoặc thuộc user/tenant khác (route trả 404 như nhau, C1-R09). */
  getConversation(owner: Owner, id: string): ConvRec | null {
    const c = this.convs.get(id);
    return c && isOwned(c, owner) ? c : null;
  }

  createConversation(owner: Owner, title: string, at = this.clock()): ConvRec {
    const c: ConvRec = {
      userId: owner.userId,
      tenantId: owner.tenantId,
      id: crypto.randomUUID(),
      title,
      createdAt: at,
      updatedAt: at,
      deleted: false,
    };
    this.convs.set(c.id, c);
    return c;
  }

  renameConversation(c: ConvRec, title: string): void {
    c.title = title;
    c.updatedAt = Math.max(c.updatedAt, this.clock());
  }

  /** Xoá mềm: mọi truy cập sau đó 404. Trả id các run đang chạy để engine huỷ (B4). */
  deleteConversation(c: ConvRec): string[] {
    c.deleted = true;
    return this.flowsOf(c.id)
      .map((f) => f.activeRunId)
      .filter((id): id is string => id !== null);
  }

  /** Flow của hội thoại, sắp `created_at` tăng, hoà → `id` tăng. */
  flowsOf(convId: string): FlowRec[] {
    return [...this.flows.values()]
      .filter((f) => f.conversationId === convId)
      .sort((a, b) => a.createdAt - b.createdAt || cmpId(a.id, b.id));
  }

  /** null nếu flow không thuộc hội thoại này. */
  getFlow(convId: string, flowId: string): FlowRec | null {
    const f = this.flows.get(flowId);
    return f && f.conversationId === convId ? f : null;
  }

  /** Tin của hội thoại (hoặc một flow), theo thứ tự thêm (= `created_at` tăng). */
  messagesOf(convId: string, flowId?: string): MsgRec[] {
    const inScope = (m: Message) =>
      m.conversation_id === convId && (flowId === undefined || m.flow_id === flowId);
    return [...this.msgs.values()].filter((r) => inScope(r.message)).sort((a, b) => a.seq - b.seq);
  }

  /** C1-R01: tin ở ô chính → flow mới, `title = deriveTitle(content)`; tin user là tin đầu của flow. */
  startFlow(c: ConvRec, content: string, at = this.clock()): { flow: FlowRec; message: Message } {
    const flow: FlowRec = {
      id: crypto.randomUUID(),
      conversationId: c.id,
      title: deriveTitle(content),
      createdAt: at,
      lastActiveAt: at,
      activeRunId: null,
      messageIds: [],
    };
    this.flows.set(flow.id, flow);
    return { flow, message: this.addUserMessage(flow, content, at) };
  }

  /** C1-R02: tin vào flow có sẵn; `content` lưu nguyên văn (kể cả `#scn:`). */
  addUserMessage(flow: FlowRec, content: string, at = this.clock()): Message {
    const m = { role: "user" as const, content, run_id: null, run: null, ask: null };
    return this.push(flow, { ...m, created_at: iso(at) });
  }

  /** Luật lưu §2.3: mỗi run kết thúc tạo đúng một tin assistant (`content` = nối delta, có thể rỗng). */
  addAssistantMessage(flow: FlowRec, a: AssistantInput, at = this.clock()): Message {
    const m = { role: "assistant" as const, content: a.content, run_id: a.runId };
    return this.push(flow, { ...m, run: a.run, ask: a.ask, created_at: iso(at) });
  }

  setActiveRun(flow: FlowRec, runId: string | null): void {
    flow.activeRunId = runId;
  }

  toConversation(c: ConvRec): Conversation {
    return {
      id: c.id,
      title: c.title,
      created_at: iso(c.createdAt),
      updated_at: iso(c.updatedAt),
      flow_count: this.flowsOf(c.id).length,
    };
  }

  toFlow(f: FlowRec): Flow {
    const question = this.firstOf(f);
    if (!question) throw new Error(`flow ${f.id} không có tin`);
    return {
      id: f.id,
      conversation_id: f.conversationId,
      title: f.title,
      created_at: iso(f.createdAt),
      last_active_at: iso(f.lastActiveAt),
      message_count: f.messageIds.length,
      active_run_id: f.activeRunId,
      preview: { question, answer: this.firstOf(f, "assistant") ?? null },
    };
  }

  reset(): void {
    this.convs.clear();
    this.flows.clear();
    this.msgs.clear();
  }

  private push(flow: FlowRec, m: NewMessage): Message {
    const message: Message = {
      id: crypto.randomUUID(),
      conversation_id: flow.conversationId,
      flow_id: flow.id,
      ...m,
    };
    this.seq += 1;
    this.msgs.set(message.id, { seq: this.seq, message });
    flow.messageIds.push(message.id);
    const at = Date.parse(m.created_at);
    flow.lastActiveAt = Math.max(flow.lastActiveAt, at);
    const conv = this.convs.get(flow.conversationId);
    if (conv) conv.updatedAt = Math.max(conv.updatedAt, at);
    return message;
  }

  private firstOf(f: FlowRec, role?: Message["role"]): Message | undefined {
    for (const id of f.messageIds) {
      const m = this.msgs.get(id)?.message;
      if (m && (role === undefined || m.role === role)) return m;
    }
    return undefined;
  }
}
