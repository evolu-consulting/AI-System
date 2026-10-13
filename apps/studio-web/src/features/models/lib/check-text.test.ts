// HUB-FR-66 · AC-H4b2-02 · unit: kết quả kiểm tra → câu chữ (D3 §3), lỗi request → hành động, lệnh runbook theo hãng (D6).

import { describe, expect, test } from "bun:test";
import type { ProviderCheckResult } from "@ai/contracts/studio";
import { detailText, failureAction, loginCommandKey, resultText, runningKey } from "./check-text";

const r = (o: Partial<ProviderCheckResult>): ProviderCheckResult => ({
  status: "ok",
  error_code: null,
  http_status: null,
  message: null,
  latency_ms: null,
  checked_at: "2026-10-13T08:12:00.000Z",
  ...o,
});

describe("resultText", () => {
  test("api: ok / từng error_code / unsupported / requested", () => {
    expect(resultText(r({}), false)).toEqual({ key: "models.check.ok", tone: "ok" });
    const k = (error_code: ProviderCheckResult["error_code"]) =>
      resultText(r({ status: "error", error_code, http_status: 500 }), false).key;
    expect(k("auth_failed")).toBe("models.check.fail");
    expect(k("http_error")).toBe("models.check.httpError");
    expect(k("timeout")).toBe("models.check.timeout");
    expect(k("network")).toBe("models.check.network");
    expect(k("secret_unreadable")).toBe("models.check.secretUnreadable");
    expect(k(null)).toBe("models.check.fail");
    expect(
      resultText(r({ status: "error", error_code: "http_error", http_status: 502 }), false).params,
    ).toEqual({ status: 502 });
    expect(resultText(r({ status: "unsupported" }), false).key).toBe("models.check.unsupported");
    expect(resultText(r({ status: "requested" }), true).key).toBe("models.check.requested");
  });
  test("subscription: ok / error dùng câu phiên đăng nhập", () => {
    expect(resultText(r({}), true).key).toBe("models.check.okSub");
    expect(resultText(r({ status: "error", message: "x" }), true).key).toBe("models.check.failSub");
    expect(runningKey(true)).toBe("models.check.runningSub");
    expect(runningKey(false)).toBe("models.check.running");
  });
});

test("detailText: HTTP + lỗi nguyên văn + ms; rỗng ⇒ null", () => {
  expect(detailText(r({ http_status: 401, message: "bad key ***", latency_ms: 80 }))).toBe(
    "HTTP 401\nbad key ***\n80 ms",
  );
  expect(detailText(r({ latency_ms: 80 }))).toBeNull();
});

test("failureAction: 404/READONLY/NOT_CONFIGURED đóng hộp; khác hiện trong hộp", () => {
  expect(failureAction("NOT_FOUND")).toMatchObject({ close: true, reload: true });
  expect(failureAction("PROVIDER_READONLY").msg.key).toBe("models.errors.providerReadonly");
  expect(failureAction("NOT_CONFIGURED")).toMatchObject({ close: true, reload: false });
  expect(failureAction("INTERNAL")).toMatchObject({
    close: false,
    msg: { key: "login.err.server" },
  });
});

test("loginCommandKey theo hãng; hãng khác ⇒ null", () => {
  expect(loginCommandKey("openai")).toBe("models.guide.cmd2.openai");
  expect(loginCommandKey("anthropic")).toBe("models.guide.cmd2.anthropic");
  expect(loginCommandKey("dify")).toBeNull();
});
