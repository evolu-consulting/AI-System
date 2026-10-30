// dlc-dify · seed DEV (chạy lại được): flow hook + tool + quy trình DLC lên Dify → catalog Admin (secret + workflow, hiện
// trong Admin › Workflows như mọi workflow Dify) → agent Agent Hub (đội dlc-spec/qc/build/verify + dlc-agent, hook, tool,
// bật cho tenant, cấp quyền user; tắt agent bước kiểu cũ). Mặc định chỉ in kế hoạch; `--apply` mới ghi.
//   bun --env-file=.env.local tools/dlc-dify/seed.ts [--apply] [--processes new-system,enhancement,bug-fix]
//     [--tenant acme] [--users lan,hoa]
// Env: DLC_DIFY_SECRETS (file JSON {email,password,console_base_url}), DLC_DIFY_API_URL (Hub gọi Dify, mặc định
// http://localhost:8099/v1), DLC_KH_URL (Dify gọi KH, mặc định http://host.docker.internal:9310), DLC_HUB_URL_FOR_DIFY
// (http://host.docker.internal:4000), DLC_WS_URL_FOR_DIFY (http://host.docker.internal:4600), DLC_WS_TOKEN_FILE (token
// workspace DLC), DLC_PROMPTS_DIR (prompt vai của repo DLC, tuỳ chọn), SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD
// (platform_admin), ADMIN_API_URL, HUB_URL_SEED. Không in key/token/mật khẩu.
import { readFileSync } from "node:fs";
import {
  type Client,
  findExact,
  items,
  login,
  makeClient,
  qs,
} from "../scripts/src/seed-dify-live.api";
import { DLC_AGENT, DLC_TEAM, LEGACY_STEP_KEYS, teamSystemPrompt } from "./agents";
import { difyConsole } from "./dify-console";
import { catalogInputs } from "./dsl";
import { hookFlows } from "./hook-flows";
import { PROCESS_VARS, PROCESSES, processDsl } from "./process-flows";
import { DLC_AGENT_TOOL_KEYS, toolFlows, WS_TOOL_KEYS } from "./tool-flows";

type Env = Record<string, string | undefined>;
type Flow = {
  key: string;
  name: string;
  description: string;
  vars: ReturnType<typeof catalogInputs>;
  dsl: Record<string, unknown>;
};

function args(argv: string[]) {
  const get = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    apply: argv.includes("--apply"),
    processes: (get("--processes") ?? "new-system,enhancement,bug-fix")
      .split(",")
      .map((s) => `dlc-${s.trim()}`),
    tenant: get("--tenant") ?? "acme",
    users: (get("--users") ?? "lan,hoa").split(",").map((s) => s.trim()),
    /** Chỉ import lại các flow này (không đụng catalog / agent). */
    only: get("--flows")
      ?.split(",")
      .map((s) => s.trim()),
  };
}

function flowsOf(e: Env, wanted: string[]): Flow[] {
  const khUrl = e.DLC_KH_URL || "http://host.docker.internal:9310";
  const hubUrl = e.DLC_HUB_URL_FOR_DIFY || "http://host.docker.internal:4000";
  const wsUrl = e.DLC_WS_URL_FOR_DIFY || "http://host.docker.internal:4600";
  const wsToken = readFileSync(
    e.DLC_WS_TOKEN_FILE || "E:/STTTemp/dlc-dify-local/.ws-token",
    "utf8",
  ).trim();
  const hooks = hookFlows({ khUrl, personaPath: "/personas/render" }).map((h) => ({
    ...h,
    vars: catalogInputs(h.vars),
  }));
  const tools = toolFlows({ hubUrl, wsUrl, wsToken, khUrl }).map((t) => ({
    ...t,
    vars: catalogInputs(t.vars),
  }));
  const procs = PROCESSES.filter((p) => wanted.includes(p.key)).map((p) => ({
    key: p.key,
    name: p.name,
    description: p.toolDescription,
    vars: catalogInputs(PROCESS_VARS),
    dsl: processDsl(p, { hubUrl, wsUrl, wsToken }),
  }));
  return [...hooks, ...tools, ...procs];
}

const idOf = (o: Record<string, unknown> | undefined) => (o?.id as string | undefined) ?? null;

/** Dify: import (ghi đè nếu đã có theo tên) → publish → API key. */
async function difyStep(e: Env, flows: Flow[], log: (s: string) => void) {
  const file = e.DLC_DIFY_SECRETS || "E:/Workspaces/EvoBuzz/dify-local/.local-secrets.json";
  const s = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  const dc = await difyConsole(
    s.console_base_url as string,
    s.email as string,
    s.password as string,
  );
  const out = new Map<string, { appId: string; apiKey: string }>();
  for (const f of flows) {
    const existing = await dc.findApp(f.key);
    const appId = await dc.importApp(JSON.stringify(f.dsl), existing);
    await dc.publish(appId);
    out.set(f.key, { appId, apiKey: await dc.apiKey(appId) });
    log(`dify ${f.key}: ${existing ? "cập nhật" : "tạo"} + publish`);
  }
  return out;
}

async function ensureSecret(admin: Client, name: string, value: string) {
  const cur = await findExact(admin, `secret ${name}`, "/admin/secrets", {
    field: "name",
    value: name,
  });
  if (cur) {
    await admin.call(`secret ${name}`, {
      method: "PUT",
      path: `/admin/secrets/${encodeURIComponent(name)}`,
      body: { value },
    });
    return idOf(cur) as string;
  }
  const r = await admin.call(`secret ${name}`, {
    method: "POST",
    path: "/admin/secrets",
    body: { name, value, note: "dlc-dify seed (dev) — app key Dify" },
  });
  return idOf(r.body) as string;
}

async function ensureWorkflow(admin: Client, f: Flow, want: Record<string, unknown>) {
  const cur = await findExact(admin, `workflow ${f.key}`, "/admin/workflows", {
    field: "key",
    value: f.key,
  });
  if (!cur) {
    const r = await admin.call(`workflow ${f.key}`, {
      method: "POST",
      path: "/admin/workflows",
      body: want,
    });
    return idOf(r.body) as string;
  }
  const id = idOf(cur) as string;
  const d = (await admin.call(`workflow ${f.key}`, { path: `/admin/workflows/${id}` })).body;
  const { key: _k, ...patch } = want;
  await admin.call(`workflow ${f.key}`, {
    method: "PATCH",
    path: `/admin/workflows/${id}`,
    body: { version: d.version, ...patch },
  });
  return id;
}

/** Admin: secret app key + workflow catalog (base_url = Dify service API mà Hub gọi). */
async function adminStep(
  e: Env,
  admin: Client,
  flows: Flow[],
  dify: Map<string, { appId: string; apiKey: string }>,
  log: (s: string) => void,
) {
  const base = e.DLC_DIFY_API_URL || "http://localhost:8099/v1";
  const ids = new Map<string, string>();
  for (const f of flows) {
    const d = dify.get(f.key);
    if (!d) continue;
    const secretId = await ensureSecret(
      admin,
      `DIFY_${f.key.toUpperCase().replace(/-/g, "_")}`,
      d.apiKey,
    );
    ids.set(
      f.key,
      await ensureWorkflow(admin, f, {
        key: f.key,
        name: f.name,
        description: f.description,
        app_type: "workflow",
        base_url: base,
        secret_id: secretId,
        input_schema: f.vars,
        output_field: "text",
        side_effect: false,
        dify_app_id: d.appId,
      }),
    );
  }
  log(`catalog Admin: ${ids.size} workflow`);
  return ids;
}

async function profileId(hub: Client, key: string): Promise<string> {
  const p = items(await hub.call("profiles", { path: "/studio/api/model-profiles" })).find(
    (x) => x.key === key,
  );
  if (!p) throw new Error(`model profile ${key} không có`);
  return p.id as string;
}

async function agentByKey(hub: Client, key: string) {
  return findExact(hub, `agent ${key}`, "/studio/api/agents", { field: "key", value: key });
}

/** Tạo agent `agentic-cli` nếu vắng; có ⇒ PUT (giữ runtime). Trả id. */
async function ensureAgent(hub: Client, key: string, body: Record<string, unknown>) {
  const cur = await agentByKey(hub, key);
  if (!cur) {
    const r = await hub.call(`agent ${key}`, {
      method: "POST",
      path: "/studio/api/agents",
      body: { runtime: "agentic-cli", key, ...body },
    });
    return ((r.body.agent as Record<string, unknown>)?.id ?? r.body.id) as string;
  }
  const id = idOf(cur) as string;
  const d = (await hub.call(`agent ${key}`, { path: `/studio/api/agents/${id}` })).body;
  await hub.call(`agent ${key}`, {
    method: "PUT",
    path: `/studio/api/agents/${id}`,
    body: { ...body, version: d.version },
  });
  return id;
}

async function setHooks(
  hub: Client,
  agentId: string,
  hooks: { event: string; workflow_id: string }[],
) {
  const d = (await hub.call("hooks", { path: `/studio/api/agents/${agentId}` })).body;
  await hub.call("hooks", {
    method: "PUT",
    path: `/studio/api/agents/${agentId}/hooks`,
    body: { hooks, version: d.version },
  });
}

/** Bật agent cho tenant + cấp quyền từng user. */
async function access(
  hub: Client,
  admin: Client,
  agentId: string,
  tenant: string,
  users: string[],
) {
  const t = await findExact(admin, "tenant", "/admin/tenants", { field: "key", value: tenant });
  const tid = idOf(t) as string;
  await hub.call("entitlement", {
    method: "PUT",
    path: `/studio/api/agent-entitlements/${agentId}/${tid}`,
  });
  for (const u of users) {
    const row = await findExact(admin, `user ${u}`, "/admin/users", {
      field: "username",
      value: u,
      query: { tenant_id: tid },
    });
    if (!row) continue;
    await hub.call(`grant ${u}`, {
      method: "POST",
      path: `/agent-grants${qs({ tenant_id: tid })}`,
      body: { agent_id: agentId, subject_type: "user", subject_id: idOf(row) },
      ok: [200, 201, 409],
    });
  }
}

const HOOK_FLOW: Record<string, string> = {
  SessionStart: "dlc-hook-session-start",
  UserPromptSubmit: "dlc-hook-user-prompt-submit",
  PreToolUse: "dlc-hook-pre-tool-use",
  PostToolUse: "dlc-hook-post-tool-use",
  Stop: "dlc-hook-stop",
  PostCompact: "dlc-hook-post-compact",
};

async function hubStep(
  e: Env,
  hub: Client,
  admin: Client,
  wf: Map<string, string>,
  a: ReturnType<typeof args>,
  log: (s: string) => void,
) {
  const std = await profileId(hub, "claude-sub-std");
  const deep = await profileId(hub, "claude-sub-deep");
  const hooks = Object.entries(HOOK_FLOW)
    .map(([event, key]) => ({ event, workflow_id: wf.get(key) as string }))
    .filter((h) => h.workflow_id);
  const wsTools = WS_TOOL_KEYS.map((k) => wf.get(k)).filter((x): x is string => !!x);
  for (const s of DLC_TEAM) {
    const id = await ensureAgent(hub, s.key, {
      name: s.name,
      description: s.description,
      profile_id: s.profile === "claude-sub-deep" ? deep : std,
      model: null,
      system_prompt: teamSystemPrompt(s, e.DLC_PROMPTS_DIR),
      runtime_options: {
        cli: "claude",
        allowed_tools: ["Read"],
        mcp: true,
        cwd_mode: "job",
        max_turns: s.maxTurns,
        persona_project: s.persona,
      },
      workflow_ids: wsTools,
      timeout_s: 3600,
      token_budget: null,
      enabled: true,
    });
    await setHooks(hub, id, hooks);
    await access(hub, admin, id, a.tenant, a.users);
    log(`agent ${s.key}: persona ${s.persona}, ${hooks.length} hook, ${wsTools.length} tool`);
  }
  const tools = [...DLC_AGENT_TOOL_KEYS, ...a.processes]
    .map((k) => wf.get(k))
    .filter((x): x is string => !!x);
  const id = await ensureAgent(hub, DLC_AGENT.key, {
    name: DLC_AGENT.name,
    description: DLC_AGENT.description,
    profile_id: std,
    model: null,
    system_prompt: DLC_AGENT.systemPrompt,
    runtime_options: {
      cli: "claude",
      allowed_tools: ["Read"],
      mcp: true,
      cwd_mode: "job",
      max_turns: 30,
      persona_project: "agent-supervisor",
    },
    workflow_ids: tools,
    timeout_s: 1800,
    token_budget: null,
    enabled: true,
  });
  await setHooks(
    hub,
    id,
    hooks.filter((h) => h.event !== "PreToolUse" && h.event !== "PostToolUse"),
  );
  await access(hub, admin, id, a.tenant, a.users);
  log(
    `agent ${DLC_AGENT.key}: ${tools.length} tool (${[...DLC_AGENT_TOOL_KEYS, ...a.processes].join(", ")})`,
  );
  for (const key of LEGACY_STEP_KEYS) {
    const cur = await agentByKey(hub, key);
    if (!cur || cur.enabled === false) continue;
    const d = (await hub.call(`agent ${key}`, { path: `/studio/api/agents/${idOf(cur)}` })).body;
    await hub.call(`agent ${key}`, {
      method: "PATCH",
      path: `/studio/api/agents/${idOf(cur)}/enabled`,
      body: { enabled: false, version: d.version },
    });
    log(`agent ${key}: tắt (thay bằng đội DLC mới)`);
  }
}

export async function main(argv: string[], e: Env): Promise<number> {
  const a = args(argv);
  const log = (s: string) => console.log(s);
  const all = flowsOf(e, a.processes);
  const flows = a.only ? all.filter((f) => a.only?.includes(f.key)) : all;
  log(
    `dlc-dify seed — ${a.apply ? "APPLY" : "dry-run"}: ${flows.length} flow, ${DLC_TEAM.length + 1} agent, tenant ${a.tenant}, users ${a.users.join(",")}`,
  );
  if (!a.apply) return 0;
  const dify = await difyStep(e, flows, log);
  if (a.only) {
    log("chỉ import lại flow (--flows) — xong.");
    return 0;
  }
  const token = await login(
    e.ADMIN_API_URL || "http://localhost:3001",
    e.SEED_ADMIN_USERNAME as string,
    e.SEED_ADMIN_PASSWORD as string,
  );
  const admin = makeClient(e.ADMIN_API_URL || "http://localhost:3001", token);
  const hub = makeClient(e.HUB_URL_SEED || "http://localhost:4000", token);
  const wf = await adminStep(e, admin, flows, dify, log);
  await hubStep(e, hub, admin, wf, a, log);
  log("dlc-dify seed xong.");
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2), process.env).then(
    (c) => process.exit(c),
    (err) => {
      console.error(`dlc-dify seed lỗi: ${(err as Error).message}`);
      process.exit(1);
    },
  );
}
