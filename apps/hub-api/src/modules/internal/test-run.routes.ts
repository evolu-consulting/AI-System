// HUB-FR-51 · HUB-H2a-AC-08 · H2a-R24 · `POST /internal/test-run` (plan §2.4): token dịch vụ (`test-run.auth`, không JWT)
// → body `TestRunRequest` (400) → `TestRunService.run` → JSON `TestRunResponse` (200 cả khi run lỗi; không SSE).
// Không log header/body.
import { TestRunRequestSchema } from "@ai/contracts/hub-internal";
import { Hono } from "hono";
import { parseJson } from "../../lib/http";
import { requireServiceToken } from "./test-run.auth";
import type { TestRunService } from "./test-run.service";

/** Bun `Server.timeout(req, s)`: lời gọi sync có thể dài hơn `idleTimeout` của server. */
type IdleTimeoutControl = { timeout?: (req: Request, seconds: number) => void };
/** Biên trên hạn chạy thử (stop Dify ≤ 2 s + ghi đáp). */
const IDLE_MARGIN_S = 30;

/** Idle timeout của request = hạn chạy thật `min(timeout_s, HUB_DIFY_TIMEOUT_MAX_S)` + biên (REVIEW 1 Hub #12). */
export function testRunIdleS(timeoutS: number, timeoutMaxS: number): number {
  return Math.min(timeoutS, timeoutMaxS) + IDLE_MARGIN_S;
}

export function testRunRoutes(
  svc: TestRunService,
  o: { internalToken: string | undefined; timeoutMaxS: number },
): Hono {
  const r = new Hono();
  r.post("/test-run", requireServiceToken(o.internalToken), async (c) => {
    const req = await parseJson(c, TestRunRequestSchema);
    (c.env as IdleTimeoutControl | undefined)?.timeout?.(
      c.req.raw,
      testRunIdleS(req.command.timeout_s, o.timeoutMaxS),
    );
    return c.json(await svc.run(req));
  });
  return r;
}
