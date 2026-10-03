// CHAT-AC-31 · client HTTP + SSE cho bộ test contract (plan C1 §4.2, test-plan §4).
// Mọi body thành công parse strict bằng schema `@ai/contracts/chat`; khung SSE đọc bằng
// `createSseParser` + `toChatEvent` của contract. Sai status → ném lỗi nêu method, path, status, body
// (để "đỏ đúng lý do" đọc được ngay: route chưa có → 401/404).

import { expect } from "bun:test";
import { API_ERRORS } from "@ai/contracts";
import {
  CHAT_API_ERRORS,
  type ChatErrorCode,
  type ChatEvent,
  type Conversation,
  ConversationSchema,
  createSseParser,
  ErrorResponseSchema,
  REFRESH_COOKIE,
  TERMINAL_EVENTS,
  type TokenGrant,
  TokenGrantSchema,
  toChatEvent,
} from "@ai/contracts/chat";
import { AUTH_URL, type ContractUser, HUB_URL } from "./_env";

export type Session = { access: string; cookie: string; grant: TokenGrant };
type Init = {
  token?: string | null;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  /** Gốc URL khác (mock thứ hai của K-R6); mặc định `AUTH_URL`/`HUB_URL`. */
  base?: string;
};

/** Gọi Hub (`/conversations`, `/runs`, `/health`, `/__mock/*`) hoặc Auth (`/auth/*`). */
export async function call(method: string, path: string, init: Init = {}): Promise<Response> {
  const base = init.base ?? (path.startsWith("/auth/") ? AUTH_URL : HUB_URL);
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let body: string | undefined = init.raw;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  return fetch(`${base}${path}`, { method, headers, body, redirect: "manual" });
}

/** Status khác kỳ vọng → ném lỗi có body (không nuốt nguyên nhân). */
export async function expectStatus(res: Response, status: number, label: string): Promise<void> {
  if (res.status === status) return;
  const text = await res.text().catch(() => "");
  throw new Error(`${label}: kỳ vọng ${status}, nhận ${res.status} ${text.slice(0, 300)}`);
}

/** Body JSON thành công, parse strict. */
export async function okJson<T>(
  res: Response,
  status: number,
  schema: { parse: (v: unknown) => T },
  label: string,
): Promise<T> {
  await expectStatus(res, status, label);
  return schema.parse(await res.json());
}

/** Lỗi kênh chat: status = `CHAT_API_ERRORS[code]`, body `ErrorResponseSchema`. Trả body text để kiểm không lộ dữ liệu. */
export async function expectChatError(
  res: Response,
  code: ChatErrorCode,
  label: string,
): Promise<string> {
  await expectStatus(res, CHAT_API_ERRORS[code], label);
  const text = await res.text();
  const body = ErrorResponseSchema.parse(JSON.parse(text));
  expect(body.error.code).toBe(code);
  return text;
}

/** Lỗi `/auth/*`: mã của Admin (`API_ERRORS`). */
export async function expectAuthError(
  res: Response,
  code: keyof typeof API_ERRORS,
  label: string,
): Promise<{ code: string; message: string }> {
  await expectStatus(res, API_ERRORS[code], label);
  const body = ErrorResponseSchema.parse(await res.json());
  expect(body.error.code).toBe(code);
  return { code: body.error.code, message: body.error.message };
}

/** Giá trị cookie `ai_rt` trong `Set-Cookie` (null nếu không có) + dòng đầy đủ. */
export function refreshCookie(res: Response): { value: string; line: string } | null {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair?.indexOf("=") ?? -1;
    if (pair && eq > 0 && pair.slice(0, eq).trim() === REFRESH_COOKIE) {
      return { value: pair.slice(eq + 1).trim(), line };
    }
  }
  return null;
}

export async function login(user: ContractUser, base?: string): Promise<Session> {
  const res = await call("POST", "/auth/login", { body: user, base });
  const grant = await okJson(res, 200, TokenGrantSchema, `POST /auth/login ${user.username}`);
  return { access: grant.access_token, cookie: refreshCookie(res)?.value ?? "", grant };
}

/** Phiên lười theo file: đăng nhập ở lần dùng đầu (lỗi rơi vào ca, không vào `beforeAll`). */
export function lazySession(user: ContractUser): () => Promise<Session> {
  let p: Promise<Session> | null = null;
  return () => {
    p ??= login(user);
    return p;
  };
}

/** Bộ đếm tiêu đề tất định theo file: `"<tiền tố> #<n>"`. */
export function titles(prefix = ""): (base: string) => string {
  let n = 0;
  return (base) => {
    n += 1;
    return `${prefix}${base} #${n}`;
  };
}

export async function newConv(token: string, title: string): Promise<Conversation> {
  const res = await call("POST", "/conversations", { token, body: { title } });
  return okJson(res, 201, ConversationSchema, "POST /conversations");
}

/** Đọc stream SSE tăng dần; `next()` trả `null` khi server đóng. */
export type StreamReader = {
  readonly events: ChatEvent[];
  next(): Promise<ChatEvent | null>;
  rest(): Promise<ChatEvent[]>;
  cancel(): Promise<void>;
};

export function openStream(res: Response): StreamReader {
  if (!res.body) throw new Error("response không có body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const queue: ChatEvent[] = [];
  const events: ChatEvent[] = [];
  const feed = createSseParser((raw) => queue.push(toChatEvent(raw)));
  let done = false;
  const next = async (): Promise<ChatEvent | null> => {
    while (queue.length === 0 && !done) {
      const r = await reader.read();
      if (r.done) done = true;
      else feed(decoder.decode(r.value, { stream: true }));
    }
    const e = queue.shift() ?? null;
    if (e) events.push(e);
    return e;
  };
  const rest = async () => {
    while ((await next()) !== null) {}
    return events;
  };
  return { events, next, rest, cancel: () => reader.cancel().catch(() => undefined) };
}

/** Đọc hết stream → mọi sự kiện. */
export async function readStream(res: Response): Promise<ChatEvent[]> {
  return openStream(res).rest();
}

export type SendResult = {
  res: Response;
  runId: string;
  flowId: string;
  messageId: string;
  events: ChatEvent[];
};

/** E12 không chờ đọc stream: kiểm 200 + `text/event-stream`, trả reader. */
export async function sendOpen(
  token: string,
  convId: string,
  content: string,
  flowId?: string,
): Promise<{ res: Response; stream: StreamReader }> {
  const body = flowId ? { content, flow_id: flowId } : { content };
  const res = await call("POST", `/conversations/${convId}/messages`, { token, body });
  await expectStatus(res, 200, "POST /conversations/:id/messages");
  expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
  return { res, stream: openStream(res) };
}

/** E12 rồi đọc hết stream. */
export async function send(
  token: string,
  convId: string,
  content: string,
  flowId?: string,
): Promise<SendResult> {
  const { res, stream } = await sendOpen(token, convId, content, flowId);
  const events = await stream.rest();
  return {
    res,
    runId: res.headers.get("X-Run-Id") ?? "",
    flowId: res.headers.get("X-Flow-Id") ?? "",
    messageId: res.headers.get("X-Message-Id") ?? "",
    events,
  };
}

export function isTerminal(e: ChatEvent): boolean {
  return (TERMINAL_EVENTS as readonly string[]).includes(e.event);
}

export function terminal(events: ChatEvent[]): ChatEvent | undefined {
  return events.find(isTerminal);
}

/** Nối mọi `delta` theo thứ tự. */
export function joinDeltas(events: ChatEvent[]): string {
  return events.map((e) => (e.event === "delta" ? e.data.text : "")).join("");
}

/** Mọi khoá object ở mọi độ sâu (CHAT-AC-33). */
export function deepKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) deepKeys(v, out);
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      deepKeys(v, out);
    }
  }
  return out;
}

export const FORBIDDEN_KEYS = ["agent", "provider", "model", "usage"] as const;

/** uuid hợp lệ, cố định, không trỏ tài nguyên nào. */
export const UNKNOWN_UUID = "00000000-0000-4000-8000-00000000c1c1";

/** Bất biến stream plan §2.5 (1)–(5); (6) strict đã kiểm khi `toChatEvent` parse. `complete` = stream từ id 1. */
export function expectInvariants(events: ChatEvent[], complete = true): void {
  expect(events.length).toBeGreaterThan(0);
  if (complete) {
    expect(events[0]?.event).toBe("run.started");
    expect(events[0]?.id).toBe(1);
  }
  const first = events[0]?.id ?? 1;
  expect(events.map((e) => e.id)).toEqual(events.map((_, i) => first + i));
  expect(events.filter(isTerminal).length).toBe(1);
  expect(isTerminal(events.at(-1) as ChatEvent)).toBe(true);
  const started = new Set<string>();
  events.forEach((e, i) => {
    if (e.event === "step.started") started.add(e.data.step_id);
    if (e.event === "step.finished" && complete) expect(started.has(e.data.step_id)).toBe(true);
    if (e.event === "ask") expect(events[i + 1]?.event).toBe("run.finished");
  });
}
