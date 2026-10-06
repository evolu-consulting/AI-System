/// <reference lib="dom" />
// X1-AC01…AC09 · helper mock Hub cho e2e chat X1 (test-plan §0 P4/P5, §8 mục 4): `page.route`, KHÔNG sửa `tools/mocks`.
// Chat-web gọi đường dẫn TƯƠNG ĐỐI (proxy cùng origin) ⇒ route khớp theo pathname trên origin chat-web.
import {
  type AgentMenuItem,
  AgentMenuResponseSchema,
  type ChatEvent,
  type CommandMenuItem,
  CommandMenuResponseSchema,
  createSseParser,
  encodeSseEvent,
  toChatEvent,
} from "@ai/contracts/chat";
import type { Page, Request, Route } from "@playwright/test";
import { SEND_PATH } from "./_support";

export const json = { "content-type": "application/json" } as const;

/** Lỗi Hub dạng `{error:{code,message,details}}` (CONVENTIONS §5). */
export function errorBody(code: string, details?: unknown): string {
  return JSON.stringify({ error: { code, message: code, ...(details ? { details } : {}) } });
}

const desc = (vi: string, en: string | null = null) => ({ vi, en });

/** 3 lệnh test-plan AC01: `translate` (alias `dich`, args `lang`, `text` rest), `summary`, `reply`. */
export const CMD_ITEMS: CommandMenuItem[] = [
  {
    name: "translate",
    aliases: ["dich"],
    description: desc("Dịch văn bản sang ngôn ngữ khác", "Translate text"),
    args: [
      {
        name: "lang",
        description: desc("Ngôn ngữ đích"),
        required: false,
        has_fallback: true,
        rest: false,
      },
      {
        name: "text",
        description: desc("Nội dung cần dịch"),
        required: true,
        has_fallback: true,
        rest: true,
      },
    ],
  },
  {
    name: "summary",
    aliases: [],
    description: desc("Tóm tắt email"),
    args: [
      {
        name: "text",
        description: desc("Email cần tóm tắt"),
        required: true,
        has_fallback: false,
        rest: true,
      },
    ],
  },
  {
    name: "reply",
    aliases: [],
    description: desc("Soạn nháp trả lời email"),
    args: [
      {
        name: "text",
        description: desc("Email cần trả lời"),
        required: true,
        has_fallback: false,
        rest: true,
      },
    ],
  },
];

export const AGENT_ITEMS: AgentMenuItem[] = [
  {
    key: "dify-chatbot",
    name: { vi: "Chatbot (Dify)", en: "Chatbot (Dify)" },
    description: "Trợ lý hội thoại chạy trên Dify cho nhân viên.",
  },
  {
    key: "trello",
    name: { vi: "Trello", en: "Trello" },
    description: "Quản lý thẻ và bảng công việc trên Trello.",
  },
];

export type Counter = { n: number };

/** Mock `GET /commands`; `handler` quyết định trả lời mỗi lần gọi (đếm trong `counter`). */
export async function routeCommands(
  page: Page,
  reply: (call: number) => { status: number; body: string } = () => ({
    status: 200,
    body: JSON.stringify(CommandMenuResponseSchema.parse({ items: CMD_ITEMS })),
  }),
): Promise<Counter> {
  const counter: Counter = { n: 0 };
  await page.route("**/commands", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    counter.n += 1;
    const r = reply(counter.n);
    await route.fulfill({ status: r.status, headers: json, body: r.body });
  });
  return counter;
}

export async function routeAgents(
  page: Page,
  reply: (call: number) => { status: number; body: string } = () => ({
    status: 200,
    body: JSON.stringify(AgentMenuResponseSchema.parse({ items: AGENT_ITEMS })),
  }),
): Promise<Counter> {
  const counter: Counter = { n: 0 };
  await page.route("**/agents", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    counter.n += 1;
    const r = reply(counter.n);
    await route.fulfill({ status: r.status, headers: json, body: r.body });
  });
  return counter;
}

/** Trả lỗi trước-stream cho mọi POST E12 (đếm số request gửi tin). */
export async function routeSendError(
  page: Page,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Promise<Counter> {
  const counter: Counter = { n: 0 };
  await page.route(SEND_PATH_GLOB, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    counter.n += 1;
    await route.fulfill({ status, headers: { ...json, ...headers }, body });
  });
  return counter;
}

/** `GET /conversations/:id/messages` (E11, có/không query). */
export const MESSAGES_GET = /\/conversations\/[^/]+\/messages(\?|$)/;

export const SEND_PATH_GLOB = (u: URL): boolean => SEND_PATH.test(u.pathname);

export const isPost = (r: Request, re: RegExp): boolean =>
  r.method() === "POST" && re.test(new URL(r.url()).pathname);

/** Gọi Hub mock thật rồi cho `edit` sửa danh sách sự kiện SSE (giữ flow/run id thật). */
export async function routeSendPatched(
  page: Page,
  edit: (events: ChatEvent[]) => ChatEvent[],
  only: (content: string) => boolean = () => true,
): Promise<void> {
  await page.route(SEND_PATH_GLOB, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const content = (route.request().postDataJSON() as { content?: string }).content ?? "";
    if (!only(content)) return route.fallback();
    const res = await route.fetch();
    const events: ChatEvent[] = [];
    createSseParser((raw) => events.push(toChatEvent(raw)))(await res.text());
    const body = edit(events).map(encodeSseEvent).join("");
    await route.fulfill({ status: res.status(), headers: stripLength(res.headers()), body });
  });
}

export const UUID_A = "11111111-1111-4111-8111-111111111111";
export const UUID_B = "22222222-2222-4222-8222-222222222222";
export const UUID_C = "33333333-3333-4333-8333-333333333333";

/** Bỏ `content-length`/`content-encoding` khi viết lại thân phản hồi (độ dài đã đổi). */
export function stripLength(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (k !== "content-length" && k !== "content-encoding") out[k] = v;
  }
  return out;
}
