// X1-AC11 · ADM-FR-23 · HUB-FR-51 · `POST /admin/commands/test` qua admin-api THẬT (tiến trình, env `ADMIN_HUB_URL` +
// `HUB_INTERNAL_TOKEN` sinh lúc chạy) + Hub stub `Bun.serve` ghi request (plan §2.2 bước 1–8g, §7 QE; test-plan §2 AC11 I).
// DB qc (createM2Env: M1 + catalog M2). Quét mọi response + stdout/stderr admin-api: không lộ token (thô/base64/hex).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { API_ERRORS, ErrorResponseSchema } from "@ai/contracts";
import { TestRunResponseSchema } from "@ai/contracts/hub-internal";
import { ALL_CATALOG, ID } from "../M2/_data";
import { ADMIN_API_URL, createM2Env, type M2Env, PW, SEED_PW, USER_ID } from "../M2/_fixtures";
import {
  adminEnv,
  json,
  leaksIn,
  loginProc,
  type Proc,
  type Recorded,
  randomToken,
  type Stub,
  spawnProc,
  startStub,
  until,
  waitHealth,
} from "./_x1";

const PORT = 3095;
const PORT_NO_HUB = 3098;
const PORT_DEAD_HUB = 3099;
const SERVER = "apps/admin-api/src/server.ts";
const TOKEN = randomToken(48);
const TEXT_MARKER = "TEXT-MARKER-qc-ac11";
const PATH = "/admin/commands/test";

type Mode =
  | "ok"
  | "ok-false"
  | "bad-schema"
  | "400"
  | "422"
  | "409"
  | "401"
  | "503"
  | "500"
  | "slow";
let mode: Mode = "ok";

const OK_BODY = {
  ok: true,
  output: "Hello",
  steps: [{ label: "dify", status: "ok", ms: 12 }],
  usage: { input_tokens: 3, output_tokens: 5, cost_usd: 0 },
  ms: 15,
};
const OK_FALSE_BODY = {
  ok: false,
  error: { code: "UPSTREAM_ERROR", message: "Dify lỗi", detail: null },
  steps: [],
  usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  ms: 9,
};
const hubErr = (code: string, details?: unknown) => ({
  error: { code, message: `hub ${code}`, ...(details === undefined ? {} : { details }) },
});

function hubHandler(_rec: Recorded, req: Request): Response | Promise<Response> {
  switch (mode) {
    case "ok":
      return json(200, OK_BODY);
    case "ok-false":
      return json(200, OK_FALSE_BODY);
    case "bad-schema":
      return json(200, { ok: true, output: "x" });
    case "400":
      return json(
        400,
        hubErr("VALIDATION_ERROR", {
          issues: [{ path: ["actor_user_id"], message: "Invalid UUID" }],
        }),
      );
    case "422":
      return json(422, hubErr("CMD_MISSING_ARG", { missing: ["text"], invalid: [] }));
    case "409":
      return json(409, hubErr("NOT_CONFIGURED"));
    case "401":
      return json(401, hubErr("UNAUTHORIZED"));
    case "503":
      return json(503, hubErr("HUB_INTERNAL_DISABLED"));
    case "500":
      return json(500, hubErr("INTERNAL"));
    case "slow":
      return new Promise<Response>((resolve) => {
        const t = setTimeout(() => resolve(json(200, OK_BODY)), 15_000);
        req.signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve(json(499, {}));
        });
      });
  }
}

let env: M2Env;
let hub: Stub;
let api: Proc;
let admin = { token: "", sub: "" };
let binh = { token: "", sub: "" };
/** Mọi thân response admin-api đã nhận trong file (quét rò cuối file). */
const seen: string[] = [];

const body = (workflowId: string, over: Record<string, unknown> = {}) => ({
  command: {
    workflow_id: workflowId,
    args: [],
    input_map: {},
    output: { field: "text", render: "markdown" },
    timeout_s: 30,
  },
  text: `en xin chào ${TEXT_MARKER}`,
  ...over,
});

async function post(
  base: string,
  token: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; text: string; json: Record<string, unknown> | undefined }> {
  const res = await fetch(`${base}${PATH}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    signal,
  });
  const text = await res.text();
  seen.push(text);
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: res.status, text, json: parsed };
}

function expectError(r: { status: number; json: unknown }, status: number, code: string) {
  expect([code, r.status]).toEqual([code, status]);
  const p = ErrorResponseSchema.safeParse(r.json);
  expect(p.success).toBe(true);
  expect(p.data?.error.code).toBe(code);
  return (p.data?.error.details ?? {}) as Record<string, unknown>;
}

const testRunCalls = () => hub.calls.filter((c) => c.path === "/internal/test-run");

beforeAll(async () => {
  env = await createM2Env({ catalog: ALL_CATALOG });
  hub = startStub(hubHandler);
  api = spawnProc(
    SERVER,
    PORT,
    adminEnv(PORT, ADMIN_API_URL, env.masterKeyB64, {
      ADMIN_HUB_URL: hub.base,
      HUB_INTERNAL_TOKEN: TOKEN,
    }),
  );
  expect(await waitHealth(api)).toBe(200);
  admin = await loginProc(api.base, "platform", "admin", SEED_PW);
  binh = await loginProc(api.base, "acme", "binh", PW);
}, 60_000);
beforeEach(async () => {
  mode = "ok";
  hub.reset();
  // Cột `side_effect` do B1 thêm; chưa có ⇒ ca 409 đỏ ở expect (không đổ beforeEach).
  const [col] = await env.owner<
    { n: number }[]
  >`select count(*)::int as n from information_schema.columns
    where table_schema = 'admin' and table_name = 'workflows' and column_name = 'side_effect'`;
  if (col?.n === 1) {
    await env.owner.unsafe(
      `update admin.workflows set side_effect = (id = '${ID.workflow.reportTax}')`,
    );
  }
});
afterAll(async () => {
  await api?.stop();
  await hub?.stop();
  await env?.close();
});

describe("X1-AC11 · bước 1–6 (trước khi gọi Hub)", () => {
  it("X1-AC11 · ADM-FR-23 · tenant_admin (binh) → 403 FORBIDDEN trước parse body (body rác cũng 403); Hub 0 lời gọi", async () => {
    expectError(await post(api.base, binh.token, body(ID.workflow.translate)), 403, "FORBIDDEN");
    expectError(await post(api.base, binh.token, "{rác"), 403, "FORBIDDEN");
    expect(testRunCalls()).toHaveLength(0);
  });

  it("X1-AC11 · body sai (thiếu command, khoá lạ, text > 16000, context.page_url không http) → 400 VALIDATION_ERROR, không echo text; Hub 0 lời gọi", async () => {
    for (const bad of [
      { text: TEXT_MARKER },
      { ...body(ID.workflow.translate), extra: 1 },
      body(ID.workflow.translate, { text: `${TEXT_MARKER}${"x".repeat(16_001)}` }),
      body(ID.workflow.translate, { context: { page_url: `ftp://${TEXT_MARKER}` } }),
    ]) {
      const r = await post(api.base, admin.token, bad);
      expectError(r, 400, "VALIDATION_ERROR");
      expect(r.text).not.toContain(TEXT_MARKER);
    }
    expect(testRunCalls()).toHaveLength(0);
  });

  it("X1-AC11 · workflow_id không có → 400 INVALID_REFERENCE {field:'workflow_id', ids:[id]}; Hub 0 lời gọi", async () => {
    const r = await post(api.base, admin.token, body(ID.unknown));
    expect(expectError(r, 400, "INVALID_REFERENCE")).toEqual({
      field: "workflow_id",
      ids: [ID.unknown],
    });
    expect(testRunCalls()).toHaveLength(0);
  });

  it("X1-AC11 · R3 · workflow side_effect (report-tax) không cờ → 409 SIDE_EFFECT_CONFIRM_REQUIRED {workflow_id}, Hub 0 lời gọi; confirm_side_effect:true → gọi Hub đúng 1 lần, 200", async () => {
    const r = await post(api.base, admin.token, body(ID.workflow.reportTax));
    expect(expectError(r, 409, "SIDE_EFFECT_CONFIRM_REQUIRED")).toEqual({
      workflow_id: ID.workflow.reportTax,
    });
    expect(
      await post(
        api.base,
        admin.token,
        body(ID.workflow.reportTax, { confirm_side_effect: false }),
      ),
    ).toMatchObject({ status: 409 });
    expect(testRunCalls()).toHaveLength(0);
    const ok = await post(
      api.base,
      admin.token,
      body(ID.workflow.reportTax, { confirm_side_effect: true }),
    );
    expect(ok.status).toBe(200);
    expect(testRunCalls()).toHaveLength(1);
  });

  it("X1-AC11 · run_as_user_id không tồn tại → 400 INVALID_REFERENCE {field:'run_as_user_id'}; Hub 0 lời gọi", async () => {
    const r = await post(
      api.base,
      admin.token,
      body(ID.workflow.translate, { run_as_user_id: ID.unknown }),
    );
    expect(expectError(r, 400, "INVALID_REFERENCE")).toEqual({
      field: "run_as_user_id",
      ids: [ID.unknown],
    });
    expect(testRunCalls()).toHaveLength(0);
  });

  it("X1-AC11 · QF · API_ERRORS vẫn 46 mã (48 − 2 theo CR-055; mã mới ở COMMAND_TEST_ERRORS)", () => {
    expect(Object.keys(API_ERRORS)).toHaveLength(46);
  });
});

describe("X1-AC11 · bước 7 (request tới Hub)", () => {
  it("X1-AC11 · HUB-FR-51 · stub nhận POST /internal/test-run: Authorization Bearer <HUB_INTERNAL_TOKEN>, body {command, text, context, actor_user_id = jwt.sub}", async () => {
    const ctx = { selection: "chọn", page_url: "https://a.test/p" };
    const r = await post(api.base, admin.token, body(ID.workflow.translate, { context: ctx }));
    expect(r.status).toBe(200);
    const [c] = testRunCalls();
    expect(c?.method).toBe("POST");
    expect(c?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    const sent = JSON.parse(c?.body ?? "{}");
    expect(sent).toMatchObject({
      command: { workflow_id: ID.workflow.translate },
      text: `en xin chào ${TEXT_MARKER}`,
      context: ctx,
      actor_user_id: admin.sub,
    });
    expect(Object.keys(sent).sort()).toEqual(["actor_user_id", "command", "context", "text"]);
  });

  it("X1-AC11 · run_as_user_id = lan → actor_user_id gửi Hub = id lan (không phải jwt.sub)", async () => {
    const r = await post(
      api.base,
      admin.token,
      body(ID.workflow.translate, { run_as_user_id: USER_ID.lan }),
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(testRunCalls()[0]?.body ?? "{}").actor_user_id).toBe(USER_ID.lan);
  });
});

describe("X1-AC11 · bước 8a–8g (ánh xạ phản hồi Hub)", () => {
  it("X1-AC11 · 8a · Hub 200 hợp schema (ok:true và ok:false) → 200 nguyên văn, parse TestRunResponseSchema", async () => {
    for (const [m, want] of [
      ["ok", OK_BODY],
      ["ok-false", OK_FALSE_BODY],
    ] as const) {
      mode = m;
      const r = await post(api.base, admin.token, body(ID.workflow.translate));
      expect([m, r.status]).toEqual([m, 200]);
      expect(TestRunResponseSchema.safeParse(r.json).success).toBe(true);
      expect(r.json).toEqual(want as unknown as Record<string, unknown>);
    }
  });

  it("X1-AC11 · 8b · Hub 200 sai schema → 502 HUB_UNAVAILABLE", async () => {
    mode = "bad-schema";
    expectError(
      await post(api.base, admin.token, body(ID.workflow.translate)),
      502,
      "HUB_UNAVAILABLE",
    );
  });

  it("X1-AC11 · 8c · Hub 400 VALIDATION_ERROR → 400, details chuyển tiếp, path actor_user_id đổi thành run_as_user_id", async () => {
    mode = "400";
    const d = expectError(
      await post(api.base, admin.token, body(ID.workflow.translate)),
      400,
      "VALIDATION_ERROR",
    );
    const issues = (d.issues ?? []) as Array<{ path: unknown[] }>;
    expect(issues[0]?.path).toEqual(["run_as_user_id"]);
    expect(JSON.stringify(d)).not.toContain("actor_user_id");
  });

  it("X1-AC11 · 8d · Hub 422 CMD_MISSING_ARG / 409 NOT_CONFIGURED → cùng mã + status, details chuyển tiếp", async () => {
    mode = "422";
    expect(
      expectError(
        await post(api.base, admin.token, body(ID.workflow.translate)),
        422,
        "CMD_MISSING_ARG",
      ),
    ).toEqual({ missing: ["text"], invalid: [] });
    mode = "409";
    expectError(
      await post(api.base, admin.token, body(ID.workflow.translate)),
      409,
      "NOT_CONFIGURED",
    );
  });

  it("X1-AC11 · 8e · Hub 401 / 503 → 503 HUB_NOT_CONFIGURED", async () => {
    for (const m of ["401", "503"] as const) {
      mode = m;
      expectError(
        await post(api.base, admin.token, body(ID.workflow.translate)),
        503,
        "HUB_NOT_CONFIGURED",
      );
    }
  });

  it("X1-AC11 · 8f · Hub 500 → 502 HUB_UNAVAILABLE", async () => {
    mode = "500";
    expectError(
      await post(api.base, admin.token, body(ID.workflow.translate)),
      502,
      "HUB_UNAVAILABLE",
    );
  });

  it("X1-AC11 · 8g · client huỷ giữa chừng → stub thấy request bị huỷ (fetch Hub bị abort)", async () => {
    mode = "slow";
    const ac = new AbortController();
    const pending = post(api.base, admin.token, body(ID.workflow.translate), ac.signal).catch(
      () => null,
    );
    expect(await until(() => testRunCalls().length === 1, 5_000)).toBe(true);
    ac.abort();
    await pending;
    expect(await until(() => testRunCalls()[0]?.aborted === true, 5_000)).toBe(true);
  }, 20_000);
});

describe("X1-AC11 · cấu hình Hub (bước 3, 8f mạng)", () => {
  it("X1-AC11 · vắng ADMIN_HUB_URL hoặc vắng HUB_INTERNAL_TOKEN → 503 HUB_NOT_CONFIGURED (sau 403/400, trước 404/409)", async () => {
    for (const over of [
      { ADMIN_HUB_URL: undefined, HUB_INTERNAL_TOKEN: TOKEN },
      { ADMIN_HUB_URL: hub.base, HUB_INTERNAL_TOKEN: undefined },
    ]) {
      const p = spawnProc(
        SERVER,
        PORT_NO_HUB,
        adminEnv(PORT_NO_HUB, ADMIN_API_URL, env.masterKeyB64, over),
      );
      try {
        expect(await waitHealth(p)).toBe(200);
        const a = await loginProc(p.base, "platform", "admin", SEED_PW);
        expectError(
          await post(p.base, a.token, body(ID.workflow.translate)),
          503,
          "HUB_NOT_CONFIGURED",
        );
        expectError(await post(p.base, a.token, body(ID.unknown)), 503, "HUB_NOT_CONFIGURED");
        expectError(await post(p.base, a.token, { text: 1 }), 400, "VALIDATION_ERROR");
      } finally {
        await p.stop();
      }
    }
    expect(testRunCalls()).toHaveLength(0);
  }, 60_000);

  it("X1-AC11 · 8f · Hub chết (cổng đóng) → 502 HUB_UNAVAILABLE, không treo", async () => {
    const dead = startStub(() => json(200, {}));
    const deadUrl = dead.base;
    await dead.stop();
    const p = spawnProc(
      SERVER,
      PORT_DEAD_HUB,
      adminEnv(PORT_DEAD_HUB, ADMIN_API_URL, env.masterKeyB64, {
        ADMIN_HUB_URL: deadUrl,
        HUB_INTERNAL_TOKEN: TOKEN,
      }),
    );
    try {
      expect(await waitHealth(p)).toBe(200);
      const a = await loginProc(p.base, "platform", "admin", SEED_PW);
      expectError(await post(p.base, a.token, body(ID.workflow.translate)), 502, "HUB_UNAVAILABLE");
    } finally {
      const out = await p.stop();
      expect(leaksIn(out, [TOKEN])).toEqual([]);
    }
  }, 40_000);
});

describe("X1-AC11 · R2 · không lộ token", () => {
  it("X1-AC11 · mọi response đã nhận + stdout/stderr admin-api không chứa HUB_INTERNAL_TOKEN (thô/base64/base64url/hex), không chứa text lệnh; có dòng log `command-test`", async () => {
    mode = "ok";
    await post(api.base, admin.token, body(ID.workflow.translate));
    expect(await until(() => api.output().includes("command-test"), 3_000)).toBe(true);
    const out = api.output();
    expect(leaksIn(seen.join("\n"), [TOKEN])).toEqual([]);
    expect(leaksIn(out, [TOKEN])).toEqual([]);
    expect(out).not.toContain(`Bearer ${TOKEN.slice(0, 16)}`);
    expect(out).not.toContain(TEXT_MARKER);
  });
});
