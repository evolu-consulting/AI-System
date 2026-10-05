// HUB-FR-50, WRK-FR-13 · POST `/mcp` (plan §2.4, §6, P7): JSON-RPC 2.0 qua JSON thường (không SSE, không session).
// Không qua JWT. Token sai → 401 thân rỗng + `WWW-Authenticate: Bearer`; GET/DELETE → 405; notification → 202.
// Không log header `Authorization` hay thân request.
import { Hono } from "hono";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { parseRpc, rpcError } from "./mcp.rules";
import type { McpService } from "./mcp.service";

type LogVars = { Variables: { log: Logger } };

/** Bun `Server.timeout(req, s)` — `tools/call` có thể dài hơn `idleTimeout` của server (SSE). */
type IdleTimeoutControl = { timeout?: (req: Request, seconds: number) => void };

export function mcpRoutes(svc: McpService, o: { requestTimeoutS: number }): Hono<LogVars> {
  const r = new Hono<LogVars>();
  r.post("/", async (c) => {
    const ctx = await svc.authenticate(c.req.header("authorization"));
    if (!ctx) return c.body(null, 401, { "WWW-Authenticate": "Bearer" });
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return c.json(rpcError(null, -32700, "Parse error"));
    }
    const req = parseRpc(body);
    if (req.kind === "error") return c.json(rpcError(req.id, req.code, req.message));
    if (req.id === null) return c.body(null, 202);
    (c.env as IdleTimeoutControl | undefined)?.timeout?.(c.req.raw, o.requestTimeoutS);
    try {
      const version = c.req.header("mcp-protocol-version");
      // Kết nối đóng (Runtime huỷ run / CLI chết) → abort Dify + stop (REVIEW 1 Hub #4).
      return c.json(await svc.handle(ctx, req, version, c.req.raw.signal));
    } catch (err) {
      c.get("log").error("mcp-failed", {
        run_id: ctx.runId,
        method: req.method,
        ...safeErrorFields(err),
      });
      return c.json(rpcError(req.id, -32603, "Internal error"));
    }
  });
  r.on(["GET", "DELETE"], "/", (c) => c.body(null, 405, { Allow: "POST" }));
  return r;
}
