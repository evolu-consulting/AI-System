// CHAT-AC-05..16, 24–27, HUB-FR-42/43 · `RunEngine` của mock chat (plan C1 §2.5, §3.1, §3.3).
// Mỗi run giữ MỌI sự kiện đã phát (`events[i].id === i + 1`) + tập listener → stream E12 và E13 (nối lại theo
// `Last-Event-ID`) đọc cùng một nguồn. Run chạy tiếp khi client rớt mạng; chỉ huỷ khi E15 / xoá hội thoại / reset.
// Kết thúc run: lưu đúng một tin assistant (nội dung = nối delta), gỡ `active_run_id`, rồi phát sự kiện kết thúc.
// Bộ nhớ (plan §5): ≤ `maxRuns` run (bỏ run đã xong cũ nhất), ≤ `maxEvents` sự kiện/run (vượt → `run.failed
// INTERNAL_ERROR`); run xong quá `retentionS` → nhả sự kiện, E13 trả 410 `EVENTS_EXPIRED` (CHAT-AC-31).
import {
  type Ask,
  type ChatEvent,
  RUN_EVENTS_RETENTION_S,
  type Run,
  type RunError,
  type RunSummary,
  type StepSummary,
} from "@ai/contracts/chat";
import {
  type Beat,
  buildScript,
  CANCELLED_ERROR,
  realWait,
  type ScenarioName,
  type ScriptEvent,
} from "./scenarios";
import type { ChatStore, FlowRec, Owner } from "./store";

type Body<E> = E extends ChatEvent ? Omit<E, "id"> : never;
/** Sự kiện chưa có `id` (engine gắn id liên tiếp khi phát). */
export type EventBody = Body<ChatEvent>;
export type Listener = (e: ChatEvent) => void;

export type RunRec = {
  id: string;
  owner: Owner;
  conversationId: string;
  flow: FlowRec;
  status: Run["status"];
  startedAt: number;
  finishedAt: number | null;
  /** Sự kiện đã phát theo thứ tự; id liên tiếp từ 1. Rỗng sau khi hết hạn giữ (`lastEventId` vẫn đúng). */
  events: ChatEvent[];
  lastEventId: number;
  listeners: Set<Listener>;
  error: RunError | null;
  steps: StepSummary[];
  labels: Map<string, string>;
  content: string;
  ask: Ask | null;
};

export type EngineDeps = {
  store: ChatStore;
  /** `MOCK_FAST`: chờ ÷10 (trừ nhịp có `fastMs`). */
  fast: boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Giữ sự kiện sau khi run kết thúc (`MOCK_EVENTS_RETENTION_S`, spec §9 M4). */
  retentionS?: number;
  maxRuns?: number;
  maxEvents?: number;
};
export type StartInput = { owner: Owner; flow: FlowRec; scenario: ScenarioName };
type Ending = { status: "finished" | "failed" | "cancelled"; ms: number; error: RunError | null };

export const MAX_RUNS = 500;
export const MAX_EVENTS_PER_RUN = 5000;
const OVERFLOW_ERROR: RunError = {
  code: "INTERNAL_ERROR",
  message: "Câu trả lời quá dài, hệ thống đã dừng.",
  hint: "Hãy thử hỏi ngắn hơn.",
};

const iso = (ms: number) => new Date(ms).toISOString();
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RunEngine {
  private readonly runs = new Map<string, RunRec>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retentionMs: number;
  private readonly maxRuns: number;
  private readonly maxEvents: number;

  constructor(private readonly d: EngineDeps) {
    this.sleep = d.sleep ?? defaultSleep;
    this.retentionMs = (d.retentionS ?? RUN_EVENTS_RETENTION_S) * 1000;
    this.maxRuns = d.maxRuns ?? MAX_RUNS;
    this.maxEvents = d.maxEvents ?? MAX_EVENTS_PER_RUN;
  }

  /** Số run đang giữ (unit test bộ nhớ). */
  get size(): number {
    return this.runs.size;
  }

  /** Tạo run cho tin user vừa thêm vào `flow`, đặt `active_run_id`, chạy kịch bản ở nền. */
  start(i: StartInput): RunRec {
    this.sweep();
    const r: RunRec = {
      id: crypto.randomUUID(),
      owner: i.owner,
      conversationId: i.flow.conversationId,
      flow: i.flow,
      status: "running",
      startedAt: this.d.store.clock(),
      finishedAt: null,
      events: [],
      lastEventId: 0,
      listeners: new Set(),
      error: null,
      steps: [],
      labels: new Map(),
      content: "",
      ask: null,
    };
    this.runs.set(r.id, r);
    this.d.store.setActiveRun(i.flow, r.id);
    const ctx = { runId: r.id, flowId: i.flow.id, messageCount: i.flow.messageIds.length };
    void this.drive(r, buildScript(i.scenario, ctx));
    return r;
  }

  /** Run của chủ (`user_id` + `tenant_id`) trong hội thoại còn sống; null → 404 (C1-R09). */
  get(owner: Owner, id: string): RunRec | null {
    const r = this.runs.get(id);
    if (!r || r.owner.userId !== owner.userId || r.owner.tenantId !== owner.tenantId) return null;
    return this.d.store.getConversation(owner, r.conversationId) ? r : null;
  }

  /** CHAT-AC-31: run đã kết thúc quá hạn giữ → sự kiện không còn (E13 410). */
  expired(r: RunRec): boolean {
    return r.finishedAt !== null && Date.now() - r.finishedAt > this.retentionMs;
  }

  /** Nhận sự kiện phát sau thời điểm gọi; trả hàm gỡ. */
  subscribe(r: RunRec, l: Listener): () => void {
    r.listeners.add(l);
    return () => r.listeners.delete(l);
  }

  /** HUB-FR-43: huỷ ngay (đồng bộ) — phát `run.failed CANCELLED`, giữ delta đã phát. Run đã xong → không đổi. */
  cancel(id: string): void {
    const r = this.runs.get(id);
    if (r?.status !== "running") return;
    const error = { code: "CANCELLED", ...CANCELLED_ERROR } as const;
    this.end(r, { status: "cancelled", ms: Math.max(0, Date.now() - r.startedAt), error });
  }

  toRun(r: RunRec): Run {
    return {
      id: r.id,
      conversation_id: r.conversationId,
      flow_id: r.flow.id,
      status: r.status,
      started_at: iso(r.startedAt),
      finished_at: r.finishedAt === null ? null : iso(r.finishedAt),
      last_event_id: r.lastEventId,
      error: r.error,
    };
  }

  /** `/__mock/reset`: huỷ run đang chạy (đóng stream đang mở) rồi quên mọi run. */
  reset(): void {
    for (const id of this.runs.keys()) this.cancel(id);
    this.runs.clear();
  }

  /** Nhả sự kiện của run hết hạn; giữ ≤ `maxRuns - 1` run trước khi thêm run mới (bỏ run đã xong cũ nhất). */
  private sweep(): void {
    for (const r of this.runs.values()) if (this.expired(r)) r.events = [];
    for (const [id, r] of this.runs) {
      if (this.runs.size < this.maxRuns) break;
      if (r.status !== "running") this.runs.delete(id);
    }
  }

  private async drive(r: RunRec, beats: Beat[]): Promise<void> {
    for (const b of beats) {
      const ms = realWait(b, this.d.fast);
      if (ms > 0) await this.sleep(ms);
      if (r.status !== "running") return;
      this.apply(r, b.event);
    }
  }

  private apply(r: RunRec, e: ScriptEvent): void {
    const last = e.event === "finish" || e.event === "fail";
    if (!last && r.events.length >= this.maxEvents - 1) {
      this.end(r, { status: "failed", ms: Date.now() - r.startedAt, error: OVERFLOW_ERROR });
      return;
    }
    switch (e.event) {
      case "finish":
        this.end(r, { status: "finished", ms: e.data.ms, error: null });
        return;
      case "fail": {
        const { ms, ...error } = e.data;
        this.end(r, { status: "failed", ms, error });
        return;
      }
      case "delta":
        r.content += e.data.text;
        break;
      case "ask":
        r.ask = e.data;
        break;
      case "step.started":
        r.labels.set(e.data.step_id, e.data.label);
        break;
      case "step.finished": {
        const label = r.labels.get(e.data.step_id) ?? e.data.step_id;
        r.steps.push({ ...e.data, label });
        break;
      }
    }
    this.emit(r, e);
  }

  /** Lưu tin assistant trước rồi mới phát sự kiện kết thúc (client đọc E11 ngay sau khi stream đóng). */
  private end(r: RunRec, o: Ending): void {
    r.status = o.status;
    r.error = o.error;
    r.finishedAt = this.d.store.clock();
    const run: RunSummary = {
      id: r.id,
      status: o.status,
      ms: o.ms,
      steps: r.steps,
      error: o.error,
    };
    const msg = this.d.store.addAssistantMessage(r.flow, {
      content: r.content,
      runId: r.id,
      run,
      ask: o.error ? null : r.ask,
    });
    this.d.store.setActiveRun(r.flow, null);
    const ids = { run_id: r.id, message_id: msg.id };
    this.emit(
      r,
      o.error
        ? { event: "run.failed", data: { ...ids, ...o.error } }
        : { event: "run.finished", data: { ...ids, content: r.content, ms: o.ms } },
    );
    r.listeners.clear();
  }

  private emit(r: RunRec, body: EventBody): void {
    r.lastEventId += 1;
    const e = { id: r.lastEventId, ...body } as ChatEvent;
    r.events.push(e);
    for (const l of [...r.listeners]) l(e);
  }
}
