// ADM-NFR-06 · chọn kịch bản mock (spec M0 T-MOCK-1) + tiện ích dùng chung cho mock Dify/Hub.
import type { Context, MiddlewareHandler } from "hono";

export type Scenario = "ok" | "unauthorized" | "timeout";
export type ScenarioTokens = { ok: string; unauthorized: string; timeout: string };

const SCENARIOS: readonly Scenario[] = ["ok", "unauthorized", "timeout"];
const BEARER_RE = /^bearer (.+)$/i;

const isScenario = (v: string | undefined): v is Scenario =>
  v !== undefined && (SCENARIOS as readonly string[]).includes(v);

/** Thứ tự: header hợp lệ (khớp chính xác) → thiếu/không dạng `Bearer <token>` → theo token → `ok`. */
export function pickScenario(input: {
  header?: string;
  authorization?: string;
  tokens: ScenarioTokens;
}): Scenario {
  if (isScenario(input.header)) return input.header;
  const token = BEARER_RE.exec(input.authorization ?? "")?.[1]?.trim();
  if (!token) return "unauthorized";
  if (token === input.tokens.unauthorized) return "unauthorized";
  if (token === input.tokens.timeout) return "timeout";
  return "ok";
}

/** "object" theo spec §3.2: object JSON, khác null, không phải mảng. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Body không phải JSON object (hoặc không có body) → `{}`. */
export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    return isPlainObject(body) ? body : {};
  } catch {
    return {};
  }
}

/** Kịch bản chạy trước mọi validate/404: `unauthorized` → trả ngay; `timeout` → chờ rồi đi tiếp. */
export function scenarioMiddleware(opts: {
  tokens: ScenarioTokens;
  timeoutMs: number;
  unauthorized: (c: Context) => Response;
}): MiddlewareHandler {
  return async (c, next) => {
    const scenario = pickScenario({
      header: c.req.header("X-Mock-Scenario"),
      authorization: c.req.header("Authorization"),
      tokens: opts.tokens,
    });
    if (scenario === "unauthorized") return opts.unauthorized(c);
    if (scenario === "timeout") await Bun.sleep(opts.timeoutMs);
    await next();
  };
}
