// HUB-FR-13, HUB-FR-89 · HUB-BR-04 · H2a-R09–R11, R17 · client Dify streaming (plan §5.2, P8: `fetch` + `createSseParser`,
// không thư viện mới). Kết quả là giá trị (không ném): lỗi HTTP/SSE/mạng → `failed{code, reason}` theo plan-errors §2;
// bẫy "HTTP 200 nhưng `workflow_finished.status=failed|stopped`" → `UPSTREAM_ERROR`. Huỷ (`signal`) → gọi stop best-effort
// (≤ `stopTimeoutMs`) rồi `aborted` — người gọi tự quyết `TIMEOUT`/`CANCELLED` theo lý do abort.
// Không bao giờ log/ném app-key: thân lỗi upstream chỉ ra ngoài qua `maskSecret(…, apiKey)` (≤ 300).
import { createSseParser } from "@ai/contracts/chat";
import type { DifyAppType } from "@ai/contracts/hub";
import type { WorkflowInputValue } from "../commands/catalog.types";
import {
  DIFY_FAILED_STATUSES,
  type DifyUsage,
  difyRunBody,
  difyRunUrl,
  difyStopUrl,
  difyUsage,
  finalText,
  interpretDifyEvent,
  mapDifyHttpError,
  maskSecret,
} from "./dify.rules";

export type DifyRunRequest = {
  appType: DifyAppType;
  baseUrl: string;
  apiKey: string;
  inputs: Record<string, WorkflowInputValue>;
  query: string | null;
  user: string;
  conversationId: string | null;
  /** `commands.output.field` / `workflows.output_field` cho `finalText`; null → `text`. */
  outputField: string | null;
};

export type DifyFailReason = "upstream" | "invalid_output";
type RunMeta = {
  taskId: string | null;
  conversationId: string | null;
  usage: DifyUsage;
  ms: number;
};
export type DifyRunOutcome =
  | ({ kind: "finished"; text: string } & RunMeta)
  | ({
      kind: "failed";
      code: "NOT_CONFIGURED" | "UPSTREAM_ERROR";
      reason: DifyFailReason;
      /** Đã che secret, ≤ 300 — chỉ cho `run_steps.detail.upstream`/trace, không cho người dùng. */
      detail: string | null;
      /** HTTP status khi lỗi HTTP (để log/trace), null với lỗi SSE/mạng. */
      httpStatus: number | null;
    } & RunMeta)
  | ({ kind: "aborted" } & RunMeta);

export type DifyClientOptions = {
  fetch?: typeof fetch;
  /** Hạn gọi stop sau huỷ (plan §5.2 "≤ 2 s"). */
  stopTimeoutMs?: number;
};

const ERROR_BODY_READ_MAX = 8_192;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;
const ZERO: DifyUsage = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };

/** Trạng thái một lần chạy: gom chunk, id, usage. */
type RunState = {
  acc: string;
  taskId: string | null;
  conversationId: string | null;
  usage: DifyUsage;
  end: { status: string; outputs: Record<string, unknown> | null } | null;
  error: string | null | undefined;
};

/** `task_id`/`conversation_id` có ở mọi sự kiện Dify (kể cả `message` của app chat — không có `workflow_started`). */
function takeIds(st: RunState, raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  const r = raw as { task_id?: unknown; conversation_id?: unknown };
  if (!st.taskId && typeof r.task_id === "string" && r.task_id) st.taskId = r.task_id;
  if (typeof r.conversation_id === "string" && r.conversation_id)
    st.conversationId = r.conversation_id;
}

/** Áp một khung SSE; trả true khi đã kết thúc (finished/error). */
function applyFrame(st: RunState, data: string, onDelta: (t: string) => void): boolean {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return false;
  }
  takeIds(st, raw);
  const ev = interpretDifyEvent(raw);
  switch (ev.kind) {
    case "delta":
      if (ev.text.length === 0) return false;
      st.acc += ev.text;
      onDelta(ev.text);
      return false;
    case "meta":
      if (ev.taskId && !st.taskId) st.taskId = ev.taskId;
      if (ev.conversationId) st.conversationId = ev.conversationId;
      return false;
    case "finished":
      st.usage = difyUsage(ev.usage);
      st.end = { status: ev.status, outputs: ev.outputs };
      return true;
    case "error":
      st.error = ev.message;
      return true;
    default:
      return false;
  }
}

async function readBodyText(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const dec = new TextDecoder();
  let out = "";
  try {
    while (out.length < max) {
      const r = await reader.read();
      if (r.done) break;
      out += dec.decode(r.value, { stream: true });
    }
  } catch {
    // thân lỗi đứt giữa chừng: dùng phần đã đọc
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out.slice(0, max);
}

export class DifyClient {
  private readonly fetchFn: typeof fetch;
  private readonly stopTimeoutMs: number;

  constructor(o: DifyClientOptions = {}) {
    this.fetchFn = o.fetch ?? fetch;
    this.stopTimeoutMs = o.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }

  /** Gọi run streaming; `onDelta` nhận từng mẩu chữ (chưa cắt). Không ném (trừ lỗi lập trình trong `onDelta`). */
  async runStreaming(
    req: DifyRunRequest,
    signal: AbortSignal,
    onDelta: (text: string) => void,
  ): Promise<DifyRunOutcome> {
    const t0 = performance.now();
    const st: RunState = {
      acc: "",
      taskId: null,
      conversationId: req.conversationId,
      usage: ZERO,
      end: null,
      error: undefined,
    };
    const meta = (): RunMeta => ({
      taskId: st.taskId,
      conversationId: st.conversationId,
      usage: st.usage,
      ms: Math.round(performance.now() - t0),
    });
    try {
      const res = await this.post(req, signal);
      if (!res.ok) return await this.httpFailed(req, res, meta);
      await this.consume(res, st, signal, onDelta);
    } catch {
      if (!signal.aborted) return this.failed("upstream", null, meta());
    }
    // Huỷ đúng lúc Dify vừa kết thúc → giữ kết quả; chưa xong → stop rồi `aborted`.
    if (signal.aborted && !st.end && st.error === undefined) {
      await this.stop(req, st.taskId);
      return { kind: "aborted", ...meta() };
    }
    return this.conclude(req, st, meta());
  }

  /** Stop best-effort (plan §5.2): không ném, chờ tối đa `stopTimeoutMs`. Không có `taskId` → bỏ qua. */
  async stop(
    req: Pick<DifyRunRequest, "appType" | "baseUrl" | "apiKey" | "user">,
    taskId: string | null,
  ): Promise<boolean> {
    if (!taskId) return false;
    try {
      const res = await this.fetchFn(difyStopUrl(req.appType, req.baseUrl, taskId), {
        method: "POST",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ user: req.user }),
        signal: AbortSignal.timeout(this.stopTimeoutMs),
      });
      await res.body?.cancel().catch(() => {});
      return res.ok;
    } catch {
      return false;
    }
  }

  private post(req: DifyRunRequest, signal: AbortSignal): Promise<Response> {
    const body = difyRunBody({
      appType: req.appType,
      inputs: req.inputs,
      query: req.query,
      user: req.user,
      conversationId: req.conversationId,
    });
    return this.fetchFn(difyRunUrl(req.appType, req.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${req.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  private async httpFailed(
    req: DifyRunRequest,
    res: Response,
    meta: () => RunMeta,
  ): Promise<DifyRunOutcome> {
    const text = await readBodyText(res, ERROR_BODY_READ_MAX);
    const detail = text ? maskSecret(text, req.apiKey) : null;
    return {
      kind: "failed",
      code: mapDifyHttpError(res.status),
      reason: "upstream",
      detail,
      httpStatus: res.status,
      ...meta(),
    };
  }

  /** Đọc SSE tới khi `finished`/`error` (rồi huỷ phần còn lại) hoặc hết luồng. */
  private async consume(
    res: Response,
    st: RunState,
    signal: AbortSignal,
    onDelta: (text: string) => void,
  ): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) return;
    let done = false;
    const parse = createSseParser((e) => {
      if (!done) done = applyFrame(st, e.data, onDelta);
    });
    const dec = new TextDecoder();
    const onAbort = () => void reader.cancel().catch(() => {});
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (!done && !signal.aborted) {
        const r = await reader.read();
        if (r.done) {
          parse(`${dec.decode()}\n\n`);
          break;
        }
        parse(dec.decode(r.value, { stream: true }));
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      await reader.cancel().catch(() => {});
    }
  }

  private conclude(req: DifyRunRequest, st: RunState, m: RunMeta): DifyRunOutcome {
    if (st.error !== undefined)
      return this.failed("upstream", st.error ? maskSecret(st.error, req.apiKey) : null, m);
    if (!st.end) return this.failed("upstream", null, m);
    if (DIFY_FAILED_STATUSES.has(st.end.status)) return this.failed("upstream", null, m);
    const text = finalText(st.acc, st.end.outputs, req.outputField);
    if (text === null) return this.failed("invalid_output", null, m);
    return { kind: "finished", text, ...m };
  }

  private failed(reason: DifyFailReason, detail: string | null, m: RunMeta): DifyRunOutcome {
    return { kind: "failed", code: "UPSTREAM_ERROR", reason, detail, httpStatus: null, ...m };
  }
}
