// X1 e2e admin · Hub stub (test-plan §2 AC11/AC12, §0 P5): Bun.serve cổng X1_HUB_STUB_PORT (mặc định 4030).
// Giả `/internal/test-run`, `/agent-grants*`, `/health` + điều khiển `/__stub/*`. Chỉ stub, không Hub thật, không Dify.
// Chạy bằng bun (webServer của `playwright.config.ts`): `bun e2e/x1/_hub-stub.ts`.

import {
  AgentGrantListResponseSchema,
  AgentGrantWriteResponseSchema,
  EffectiveAgentsResponseSchema,
} from "@ai/contracts/hub-admin";
import { type TestRunResponse, TestRunResponseSchema } from "@ai/contracts/hub-internal";
import { TENANT_ID } from "../../tests/acceptance/M1/_data";
import { ID3 } from "../../tests/acceptance/M3/_data";

const PORT = Number(process.env.X1_HUB_STUB_PORT ?? 4030);
const ORIGIN = process.env.X1_WEB_ORIGIN ?? "http://localhost:3010";
const TOKEN = process.env.HUB_INTERNAL_TOKEN ?? "";

export type StubMode = {
  /** ok | fail (ok:false) | slow (chờ tới khi client huỷ) | down (500) */
  testRun: "ok" | "fail" | "slow" | "down";
  /** ok | NOT_ENTITLED | AGENT_NOT_GRANTABLE | 500 — cho POST/DELETE /agent-grants */
  grantWrite: "ok" | "NOT_ENTITLED" | "AGENT_NOT_GRANTABLE" | "500";
};
const DEFAULT_MODE: StubMode = { testRun: "ok", grantWrite: "ok" };
let mode: StubMode = { ...DEFAULT_MODE };

export type Rec = {
  method: string;
  path: string;
  search: string;
  auth: boolean;
  authOk: boolean;
  body: unknown;
  aborted?: boolean;
};
let recs: Rec[] = [];
let granted = new Set<string>(["dify-chatbot"]); // agent key đang có grant cho nhóm ke-toan

const AGENTS = [
  {
    id: "0190a000-0000-7000-8000-000000000001",
    key: "dify-chatbot",
    vi: "Chatbot (Dify)",
    runnable: true,
  },
  { id: "0190a000-0000-7000-8000-000000000002", key: "trello", vi: "Trello", runnable: false },
] as const;
const ref = (a: (typeof AGENTS)[number]) => ({
  id: a.id,
  key: a.key,
  name: { vi: a.vi, en: a.vi },
});
const NOW = "2026-10-07T03:00:00.000Z";
const KT = ID3.group.acmeKeToan;

const GROUP = { id: KT, key: "ke-toan", name: { vi: "Kế toán" }, is_beta: false };
const grantId = (key: string): string =>
  key === "trello"
    ? "0190a000-0000-7000-8000-0000000000b2"
    : "0190a000-0000-7000-8000-0000000000b1";

function listBody() {
  return AgentGrantListResponseSchema.parse({
    tenant_id: TENANT_ID.acme,
    items: AGENTS.map((a) => ({
      agent: {
        ...ref(a),
        description: `Agent ${a.key} của Agent Studio`,
        enabled: true,
        runnable: a.runnable,
      },
      grants: granted.has(a.key)
        ? [
            {
              id: grantId(a.key),
              subject: { type: "group" as const, group: GROUP },
              granted_by: "binh",
              granted_at: NOW,
            },
          ]
        : [],
      grants_total: granted.has(a.key) ? 1 : 0,
    })),
    truncated: false,
    hub_config_version: 7,
  });
}

function effectiveBody(userId: string) {
  const [bot, trello] = AGENTS;
  return EffectiveAgentsResponseSchema.parse({
    user: { id: userId, tenant_id: TENANT_ID.acme },
    agents: [
      {
        agent: ref(bot),
        visible: true,
        reasons: [{ code: "grant_group", group: GROUP }],
        missing: [],
      },
      { agent: ref(trello), visible: false, reasons: [], missing: ["no_grant"] },
    ],
    hub_config_version: 7,
  });
}

const cors = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  vary: "origin",
};
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
const err = (status: number, code: string, details?: unknown): Response =>
  json(status, { error: { code, message: code, ...(details ? { details } : {}) } });

const okRun: TestRunResponse = TestRunResponseSchema.parse({
  ok: true,
  output: "Xin chào (bản dịch giả)",
  steps: [
    { label: "Dịch", status: "ok", ms: 120 },
    { label: "Định dạng", status: "ok", ms: 5 },
  ],
  usage: { input_tokens: 12, output_tokens: 8, cost_usd: 0 },
  ms: 125,
});
const failRun: TestRunResponse = TestRunResponseSchema.parse({
  ok: false,
  error: {
    code: "UPSTREAM_ERROR",
    message: "Dify trả lỗi 400",
    detail: "Dify: input target_lang is required",
  },
  steps: [{ label: "Dịch", status: "failed", ms: 40 }],
  usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  ms: 40,
});

async function control(req: Request, p: string): Promise<Response | null> {
  if (p === "/health") return json(200, { status: "ok" });
  if (p === "/__stub/requests") return json(200, recs);
  if (p === "/__stub/reset") {
    mode = { ...DEFAULT_MODE };
    recs = [];
    granted = new Set(["dify-chatbot"]);
    return json(200, { ok: true });
  }
  if (p === "/__stub/mode") {
    mode = { ...mode, ...((await req.json()) as Partial<StubMode>) };
    return json(200, mode);
  }
  return null;
}

async function testRun(req: Request, rec: Rec): Promise<Response> {
  if (!rec.authOk) return err(401, "UNAUTHENTICATED");
  if (mode.testRun === "down") return err(500, "INTERNAL_ERROR");
  if (mode.testRun === "slow") {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 30_000);
      req.signal.addEventListener("abort", () => {
        rec.aborted = true;
        clearTimeout(t);
        resolve();
      });
    });
    return json(200, okRun);
  }
  return json(200, mode.testRun === "fail" ? failRun : okRun);
}

function grantWriteError(): Response | null {
  if (mode.grantWrite === "500") return err(500, "INTERNAL_ERROR");
  if (mode.grantWrite === "NOT_ENTITLED") {
    return err(409, "NOT_ENTITLED", { agent_ids: [AGENTS[1].id] });
  }
  if (mode.grantWrite === "AGENT_NOT_GRANTABLE") return err(409, "AGENT_NOT_GRANTABLE");
  return null;
}

function grantWrite(req: Request, url: URL, body: unknown): Response {
  const failed = grantWriteError();
  if (failed) return failed;
  const agentId =
    req.method === "POST"
      ? (body as { agent_id?: string } | null)?.agent_id
      : url.searchParams.get("agent_id");
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) return err(400, "INVALID_REFERENCE", { field: "agent_id" });
  if (req.method === "DELETE") {
    granted.delete(agent.key);
    return new Response(null, { status: 204, headers: cors });
  }
  granted.add(agent.key);
  return json(
    201,
    AgentGrantWriteResponseSchema.parse({
      grant: {
        id: grantId(agent.key),
        tenant_id: TENANT_ID.acme,
        agent: ref(agent),
        subject: { type: "group", group: GROUP },
        granted_by: "binh",
        granted_at: NOW,
      },
      hub_config_version: 8,
    }),
  );
}

async function route(req: Request, url: URL, rec: Rec, body: unknown): Promise<Response> {
  const p = url.pathname;
  if (p === "/internal/test-run" && req.method === "POST") return testRun(req, rec);
  if (p === "/agent-grants" && req.method === "GET") return json(200, listBody());
  if (p.startsWith("/agent-grants/effective/") && req.method === "GET") {
    return json(200, effectiveBody(p.split("/").pop() ?? ""));
  }
  if (p === "/agent-grants" && ["POST", "DELETE"].includes(req.method)) {
    return grantWrite(req, url, body);
  }
  return err(404, "NOT_FOUND");
}

Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const ctl = await control(req, url.pathname);
    if (ctl) return ctl;
    const authz = req.headers.get("authorization");
    const body = ["POST", "PUT", "PATCH"].includes(req.method)
      ? await req
          .clone()
          .json()
          .catch(() => null)
      : null;
    const rec: Rec = {
      method: req.method,
      path: url.pathname,
      search: url.search,
      auth: authz !== null,
      authOk: authz === `Bearer ${TOKEN}` && TOKEN !== "",
      body,
    };
    recs.push(rec);
    return route(req, url, rec, body);
  },
});
console.log(`x1 hub stub :${PORT}`);
