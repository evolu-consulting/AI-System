// X1-AC11 · ADM-FR-23 · luật thuần Test command (plan §2.2): `testRunPrecheck` (bước 3–6, trượt đầu tiên),
// `mapHubTestRun` (bảng 8a–8f) + contract `command-test.ts` (`COMMAND_TEST_ERRORS`, K4: không đụng `API_ERRORS` khoá 48).
// Nạp động (P7) ⇒ đỏ "Cannot find module" tới khi B2 xong.
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { API_ERRORS, ErrorResponseSchema } from "@ai/contracts";
import { TestRunResponseSchema } from "@ai/contracts/hub-internal";
import { type Loose, loadCommandTestContract, loadCommandTestRules } from "../_modules";

const WF = "01900000-0000-7000-8000-0000000a1101";
const USER = "01900000-0000-7000-8000-0000000a1102";
type Pre = {
  hubConfigured: boolean;
  workflow: { id: string; sideEffect: boolean } | null;
  workflowId: string;
  confirm: boolean | undefined;
  runAs: { requested?: string; exists: boolean };
};
const base: Pre = {
  hubConfigured: true,
  workflow: { id: WF, sideEffect: false },
  workflowId: WF,
  confirm: undefined,
  runAs: { exists: true },
};
const pre = async (over: Partial<Pre>): Promise<Loose> =>
  (await loadCommandTestRules()).testRunPrecheck({ ...base, ...over });
const map = async (status: number | "network" | "timeout", body: unknown): Promise<Loose> =>
  (await loadCommandTestRules()).mapHubTestRun(status, body);
const errCode = (r: Loose): string => ErrorResponseSchema.parse(r.body).error.code;

const OK_BODY = {
  ok: true,
  output: "Hello",
  steps: [{ label: "dify", status: "ok", ms: 120 }],
  usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0 },
  ms: 130,
};
const FAIL_BODY = {
  ok: false,
  error: { code: "UPSTREAM_ERROR", message: "Dify lỗi", detail: "400 bad input" },
  steps: [],
  usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  ms: 40,
};

describe("X1-AC11 · testRunPrecheck (plan §2.2 bước 3–6)", () => {
  it("X1-AC11 · đủ điều kiện ⇒ {ok:true}; side_effect + confirm=true ⇒ ok; run_as có và tồn tại ⇒ ok", async () => {
    expect(await pre({})).toEqual({ ok: true });
    expect(await pre({ workflow: { id: WF, sideEffect: true }, confirm: true })).toEqual({
      ok: true,
    });
    expect(await pre({ runAs: { requested: USER, exists: true } })).toEqual({ ok: true });
  });

  it("X1-AC11 · bước 3: Hub chưa cấu hình ⇒ HUB_NOT_CONFIGURED (thắng mọi lỗi sau)", async () => {
    const r = await pre({
      hubConfigured: false,
      workflow: null,
      runAs: { requested: USER, exists: false },
    });
    expect(r).toMatchObject({ ok: false, code: "HUB_NOT_CONFIGURED" });
  });

  it("X1-AC11 · bước 4: workflow không có ⇒ INVALID_REFERENCE {field:'workflow_id', ids:[id]} (trước side_effect/run_as)", async () => {
    const r = await pre({ workflow: null, runAs: { requested: USER, exists: false } });
    expect(r).toEqual({
      ok: false,
      code: "INVALID_REFERENCE",
      details: { field: "workflow_id", ids: [WF] },
    });
  });

  it("X1-AC11 · bước 5: side_effect=true, confirm vắng/false ⇒ SIDE_EFFECT_CONFIRM_REQUIRED {workflow_id} (trước run_as)", async () => {
    for (const confirm of [undefined, false]) {
      const r = await pre({
        workflow: { id: WF, sideEffect: true },
        confirm,
        runAs: { requested: USER, exists: false },
      });
      expect(r).toEqual({
        ok: false,
        code: "SIDE_EFFECT_CONFIRM_REQUIRED",
        details: { workflow_id: WF },
      });
    }
  });

  it("X1-AC11 · bước 6: run_as_user_id không tồn tại ⇒ INVALID_REFERENCE {field:'run_as_user_id', ids:[id]}", async () => {
    const r = await pre({ runAs: { requested: USER, exists: false } });
    expect(r).toEqual({
      ok: false,
      code: "INVALID_REFERENCE",
      details: { field: "run_as_user_id", ids: [USER] },
    });
  });
});

describe("X1-AC11 · mapHubTestRun (plan §2.2 bảng 8a–8f)", () => {
  it("X1-AC11 · 8a: Hub 200 đúng TestRunResponseSchema ⇒ 200 nguyên văn (cả ok:true lẫn ok:false)", async () => {
    expect(TestRunResponseSchema.safeParse(OK_BODY).success).toBe(true);
    expect(TestRunResponseSchema.safeParse(FAIL_BODY).success).toBe(true);
    expect(await map(200, OK_BODY)).toEqual({ status: 200, body: OK_BODY });
    expect(await map(200, FAIL_BODY)).toEqual({ status: 200, body: FAIL_BODY });
  });

  it("X1-AC11 · 8b: Hub 200 sai schema ⇒ 502 HUB_UNAVAILABLE", async () => {
    for (const bad of [{ ok: true }, { ok: "yes", output: 1 }, null, "html"]) {
      const r = await map(200, bad);
      expect(r.status).toBe(502);
      expect(errCode(r)).toBe("HUB_UNAVAILABLE");
    }
  });

  it("X1-AC11 · 8c: Hub 400 VALIDATION_ERROR ⇒ 400 chuyển details, path actor_user_id đổi thành run_as_user_id", async () => {
    const hub = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Dữ liệu không hợp lệ",
        details: { issues: [{ path: ["actor_user_id"], message: "Invalid UUID" }] },
      },
    };
    const r = await map(400, hub);
    expect(r.status).toBe(400);
    expect(errCode(r)).toBe("VALIDATION_ERROR");
    const s = JSON.stringify(r.body);
    expect(s).toContain("run_as_user_id");
    expect(s).not.toContain("actor_user_id");
  });

  it("X1-AC11 · 8d: Hub 422 CMD_MISSING_ARG / 409 NOT_CONFIGURED ⇒ giữ mã + status + details", async () => {
    const miss = {
      error: {
        code: "CMD_MISSING_ARG",
        message: "Thiếu tham số",
        details: { name: "translate", missing: ["text"], invalid: [] },
      },
    };
    const r1 = await map(422, miss);
    expect(r1.status).toBe(422);
    expect(ErrorResponseSchema.parse(r1.body).error).toMatchObject({
      code: "CMD_MISSING_ARG",
      details: { name: "translate", missing: ["text"], invalid: [] },
    });
    const r2 = await map(409, { error: { code: "NOT_CONFIGURED", message: "Thiếu secret" } });
    expect(r2.status).toBe(409);
    expect(errCode(r2)).toBe("NOT_CONFIGURED");
  });

  it("X1-AC11 · 8e: Hub 401 / 503 ⇒ 503 HUB_NOT_CONFIGURED", async () => {
    for (const st of [401, 503]) {
      const r = await map(st, { error: { code: "UNAUTHENTICATED", message: "x" } });
      expect(r.status).toBe(503);
      expect(errCode(r)).toBe("HUB_NOT_CONFIGURED");
    }
  });

  it("X1-AC11 · 8f: network / timeout / 500 / 504 ⇒ 502 HUB_UNAVAILABLE", async () => {
    for (const st of ["network", "timeout", 500, 504] as const) {
      const r = await map(st, undefined);
      expect(r.status).toBe(502);
      expect(errCode(r)).toBe("HUB_UNAVAILABLE");
    }
  });

  it("X1-AC11 · output không chứa token/header dù body Hub có (không echo message lạ của 401/5xx)", async () => {
    const tok = randomBytes(36).toString("base64url");
    for (const st of [401, 500, 503]) {
      const r = await map(st, {
        error: {
          code: "INTERNAL_ERROR",
          message: `Bearer ${tok}`,
          details: { authorization: tok },
        },
      });
      expect(JSON.stringify(r)).not.toContain(tok);
    }
  });
});

describe("X1-AC11 · contract command-test.ts (plan §2.2, K4)", () => {
  it("X1-AC11 · COMMAND_TEST_ERRORS đúng 5 mã; API_ERRORS vẫn 48 và không chứa mã riêng của Test", async () => {
    const c = await loadCommandTestContract();
    expect(c.COMMAND_TEST_ERRORS).toEqual({
      CMD_MISSING_ARG: 422,
      NOT_CONFIGURED: 409,
      SIDE_EFFECT_CONFIRM_REQUIRED: 409,
      HUB_UNAVAILABLE: 502,
      HUB_NOT_CONFIGURED: 503,
    });
    expect(Object.keys(API_ERRORS)).toHaveLength(48);
    for (const k of ["SIDE_EFFECT_CONFIRM_REQUIRED", "HUB_UNAVAILABLE", "HUB_NOT_CONFIGURED"])
      expect(Object.keys(API_ERRORS)).not.toContain(k);
  });

  it("X1-AC11 · CommandTestRequestSchema: nhận bản nháp + run_as_user_id + confirm_side_effect; từ chối actor_user_id, run_as không uuid, text quá dài", async () => {
    const { CommandTestRequestSchema: S } = await loadCommandTestContract();
    const command = { workflow_id: WF, output: { field: "text", render: "markdown" } };
    const ok = S.safeParse({
      command,
      text: "en Xin chào",
      run_as_user_id: USER,
      confirm_side_effect: true,
    });
    expect(ok.success).toBe(true);
    expect(ok.data.command).toMatchObject({ args: [], input_map: {}, timeout_s: 30 });
    expect(
      S.safeParse({ command, text: "x", context: { page_url: "https://a.test/p" } }).success,
    ).toBe(true);
    expect(S.safeParse({ command, text: "x", actor_user_id: USER }).success).toBe(false);
    expect(S.safeParse({ command, text: "x", run_as_user_id: "lan" }).success).toBe(false);
    expect(S.safeParse({ command, text: "x".repeat(16_001) }).success).toBe(false);
  });

  it("X1-AC11 · CommandTestResponseSchema ≡ TestRunResponseSchema (ms; không duration_ms); SideEffectConfirmDetailsSchema {workflow_id}", async () => {
    const c = await loadCommandTestContract();
    expect(c.CommandTestResponseSchema.safeParse(OK_BODY).success).toBe(true);
    expect(c.CommandTestResponseSchema.safeParse(FAIL_BODY).success).toBe(true);
    const { ms: _ms, ...noMs } = OK_BODY;
    expect(c.CommandTestResponseSchema.safeParse({ ...noMs, duration_ms: 1 }).success).toBe(false);
    expect(c.SideEffectConfirmDetailsSchema.safeParse({ workflow_id: WF }).success).toBe(true);
    expect(c.SideEffectConfirmDetailsSchema.safeParse({ workflow_id: WF, x: 1 }).success).toBe(
      false,
    );
  });
});
