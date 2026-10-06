// ADM-FR-23 · HUB-FR-51 · client gọi Hub `POST /internal/test-run` bằng token dịch vụ (plan X1 §2.2 bước 7).
// Token chỉ nằm trong header gửi Hub: không log, không đưa vào lỗi/response.
import type { TestRunRequest } from "@ai/contracts/hub-internal";

export type HubConfig = { url: string; token: string };
export type HubCallResult = { status: number | "network" | "timeout"; body: unknown };

/** Biên chờ Hub trên hạn chạy (Hub tự cộng 30 s idle; thêm 5 s mạng). */
export const HUB_WAIT_MARGIN_S = 35;
export const TEST_RUN_MAX_S = 300;

export function hubWaitS(timeoutS: number): number {
  return Math.min(timeoutS, TEST_RUN_MAX_S) + HUB_WAIT_MARGIN_S;
}

const isAbort = (e: unknown, name: string) => e instanceof Error && e.name === name;

/**
 * `clientSignal` huỷ (nút "Dừng") ⇒ fetch Hub bị huỷ, ném lại `AbortError` để route không trả body (8g).
 * Hết hạn chờ ⇒ `timeout`; lỗi mạng ⇒ `network`. Body không phải JSON ⇒ `undefined` (map thành 502).
 */
export async function callHubTestRun(
  cfg: HubConfig,
  req: TestRunRequest,
  clientSignal: AbortSignal,
): Promise<HubCallResult> {
  const timeout = AbortSignal.timeout(hubWaitS(req.command.timeout_s) * 1000);
  const signal = AbortSignal.any([clientSignal, timeout]);
  try {
    const res = await fetch(`${cfg.url.replace(/\/+$/, "")}/internal/test-run`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(req),
      signal,
      redirect: "error",
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: res.status, body };
  } catch (e) {
    if (clientSignal.aborted) throw e;
    if (timeout.aborted || isAbort(e, "TimeoutError"))
      return { status: "timeout", body: undefined };
    return { status: "network", body: undefined };
  }
}
