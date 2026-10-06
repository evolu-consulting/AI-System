// ADM-FR-21 · HUB-FR-89 · X1-R14 · các bước `--apply` của `seed:dify` (plan X1 §5.4): mọi bước qua API, đọc trước rồi chỉ
// ghi khi vắng/khác ⇒ chạy lại không sinh audit; KHÔNG bao giờ xoá. Key chỉ là `value` của bước secret, không in, không log.
import { type Client, findExact, items, qs, SeedStepError } from "./seed-dify-live.api";
import { SECRET_NOTE, type SeedApp } from "./seed-dify-live.apps";
import {
  type CommandWant,
  commandPatch,
  type SeedPlan,
  type WorkflowWant,
  workflowPatch,
} from "./seed-dify-live.rules";

type Obj = Record<string, unknown>;
export type Log = (line: string) => void;
export type RunCtx = { admin: Client; log: Log; plan: SeedPlan };

const idOf = (o: Obj | undefined, step: string): string => {
  if (!o || typeof o.id !== "string") throw new SeedStepError(step, 0, "NOT_FOUND");
  return o.id;
};

export async function findTenant(c: RunCtx): Promise<string> {
  const t = await findExact(c.admin, "tenant", "/admin/tenants", {
    field: "key",
    value: c.plan.tenant,
  });
  return idOf(t, `tenant ${c.plan.tenant}`);
}

/** Bước 2: group theo `key` trong tenant + thành viên (đã có ⇒ bỏ qua; username lạ ⇒ cảnh báo). */
export async function ensureGroup(c: RunCtx, tenantId: string): Promise<string> {
  const g = c.plan.group;
  const found = await findExact(c.admin, "group", "/admin/groups", {
    field: "key",
    value: g.key,
    query: { tenant_id: tenantId },
  });
  let id = found?.id as string | undefined;
  if (!id) {
    const r = await c.admin.call("group", {
      method: "POST",
      path: `/admin/groups${qs({ tenant_id: tenantId })}`,
      body: { key: g.key, name: g.name, description: g.description },
    });
    id = idOf(r.body, "group");
  }
  c.log(`group ${g.key}: ${found ? "giữ nguyên" : "tạo"}`);
  for (const u of g.members) {
    const m = await findExact(c.admin, "group-member", `/admin/groups/${id}/members`, {
      field: "username",
      value: u,
    });
    if (m) continue;
    const r = await c.admin.call("group-member", {
      method: "POST",
      path: `/admin/groups/${id}/members`,
      body: { usernames: [u] },
    });
    const notFound = Array.isArray(r.body.not_found) && r.body.not_found.includes(u);
    c.log(notFound ? `CẢNH BÁO: user ${u} không có trong tenant` : `thành viên ${u}: thêm`);
  }
  return id;
}

/** Bước 3: secret theo tên — vắng ⇒ tạo; có ∧ `--rotate-secrets` ⇒ thay giá trị; có ⇒ giữ. Trả `tên → id`. */
export async function ensureSecrets(
  c: RunCtx,
  keys: ReadonlyMap<SeedApp, string>,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const s of c.plan.secrets) {
    const value = keys.get(s.app);
    if (!value) throw new SeedStepError(`secret ${s.name}`, 0, "MISSING_KEY");
    const cur = await findExact(c.admin, `secret ${s.name}`, "/admin/secrets", {
      field: "name",
      value: s.name,
    });
    if (!cur) {
      const r = await c.admin.call(`secret ${s.name}`, {
        method: "POST",
        path: "/admin/secrets",
        body: { name: s.name, value, note: SECRET_NOTE },
      });
      ids.set(s.name, idOf(r.body, `secret ${s.name}`));
      c.log(`secret ${s.name}: tạo`);
      continue;
    }
    ids.set(s.name, idOf(cur, `secret ${s.name}`));
    if (c.plan.rotate_secrets)
      await c.admin.call(`secret ${s.name}`, {
        method: "PUT",
        path: `/admin/secrets/${encodeURIComponent(s.name)}`,
        body: { value },
      });
    c.log(`secret ${s.name}: ${c.plan.rotate_secrets ? "xoay giá trị" : "giữ nguyên"}`);
  }
  return ids;
}

/** Bước 4: feature theo `key` (tồn tại ⇒ dùng lại, không sửa). */
export async function ensureFeature(c: RunCtx): Promise<string> {
  const f = c.plan.feature;
  const cur = await findExact(c.admin, "feature", "/admin/features", {
    field: "key",
    value: f.key,
  });
  c.log(`feature ${f.key}: ${cur ? "giữ nguyên" : "tạo"}`);
  if (cur) return idOf(cur, "feature");
  const r = await c.admin.call("feature", {
    method: "POST",
    path: "/admin/features",
    body: { key: f.key, name: f.name, status: "on", command_ids: [] },
  });
  return idOf(r.body, "feature");
}

function workflowBody(w: WorkflowWant, secretId: string): Obj {
  const { secret_name: _s, ...rest } = w;
  return { ...rest, secret_id: secretId };
}

async function patchWorkflow(c: RunCtx, id: string, want: Obj): Promise<boolean | "skip"> {
  const step = `workflow ${want.key}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const d = (await c.admin.call(step, { path: `/admin/workflows/${id}` })).body;
    const secret = d.secret as Obj | undefined;
    if (secret?.id !== undefined && secret.id !== want.secret_id) {
      c.log(`CẢNH BÁO: ${step} đã có, dùng secret khác (không phải seed tạo) — bỏ qua`);
      return "skip";
    }
    const patch = workflowPatch({ ...d, secret_id: secret?.id }, want);
    if (!patch) return false;
    const r = await c.admin.call(step, {
      method: "PATCH",
      path: `/admin/workflows/${id}`,
      body: { version: d.version, ...patch },
      ok: [200, 409],
    });
    if (r.status === 200) return true;
  }
  throw new SeedStepError(step, 409, "VERSION_CONFLICT");
}

/** Bước 5: workflow theo `key` — vắng ⇒ POST; khác ⇒ PATCH (409 ⇒ đọc lại 1 lần). Trả `key → id`. */
export async function ensureWorkflows(
  c: RunCtx,
  secretIds: Map<string, string>,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const w of c.plan.workflows) {
    const want = workflowBody(w, secretIds.get(w.secret_name) as string);
    const cur = await findExact(c.admin, `workflow ${w.key}`, "/admin/workflows", {
      field: "key",
      value: w.key,
    });
    if (!cur) {
      const r = await c.admin.call(`workflow ${w.key}`, {
        method: "POST",
        path: "/admin/workflows",
        body: want,
      });
      ids.set(w.key, idOf(r.body, `workflow ${w.key}`));
      c.log(`workflow ${w.key}: tạo`);
      continue;
    }
    const id = idOf(cur, `workflow ${w.key}`);
    ids.set(w.key, id);
    const pr = await patchWorkflow(c, id, want);
    if (pr !== "skip") c.log(`workflow ${w.key}: ${pr ? "cập nhật" : "giữ nguyên"}`);
  }
  return ids;
}

function commandBody(cmd: CommandWant): Obj {
  const { workflow_key: _w, ...rest } = cmd;
  return rest;
}

async function updateCommand(c: RunCtx, cur: Obj, want: Obj): Promise<string> {
  const step = `command /${want.name}`;
  const d = (await c.admin.call(step, { path: `/admin/commands/${cur.id}` })).body;
  const patch = commandPatch(d, want);
  if (!patch) return "giữ nguyên";
  await c.admin.call(step, {
    method: "PATCH",
    path: `/admin/commands/${cur.id}`,
    body: { version: d.version, ...patch },
  });
  return "cập nhật";
}

/** Bước 6: command theo `name`; đã gắn workflow khác ⇒ bỏ qua + cảnh báo (không chiếm lệnh người khác). */
export async function ensureCommands(
  c: RunCtx,
  wfIds: Map<string, string>,
  featureId: string,
): Promise<void> {
  for (const cmd of c.plan.commands) {
    const wfId = wfIds.get(cmd.workflow_key) as string;
    const want = commandBody(cmd);
    const step = `command /${cmd.name}`;
    const cur = await findExact(c.admin, step, "/admin/commands", {
      field: "name",
      value: cmd.name,
    });
    if (!cur) {
      const r = await c.admin.call(step, {
        method: "POST",
        path: "/admin/commands",
        body: { ...want, workflow_id: wfId, feature_ids: [featureId] },
        ok: [201, 200, 409],
      });
      c.log(
        r.status === 409 ? `CẢNH BÁO: ${step} trùng tên/alias lệnh khác — bỏ qua` : `${step}: tạo`,
      );
      continue;
    }
    if ((cur.workflow as Obj | undefined)?.id !== wfId) {
      c.log(`CẢNH BÁO: ${step} đã gắn workflow khác — bỏ qua (không chiếm lệnh của người khác)`);
      continue;
    }
    c.log(`${step}: ${await updateCommand(c, cur, want)}`);
  }
}

/** Bước 7: entitlement feature → tenant và grant feature → group (đã có ⇒ không ghi). */
export async function ensureAccess(
  c: RunCtx,
  ids: { tenant: string; feature: string; group: string },
): Promise<void> {
  const ents = await c.admin.call("entitlement", {
    path: `/admin/features/${ids.feature}/entitlements${qs({ q: c.plan.tenant, limit: 200 })}`,
  });
  const entitled = items(ents).some((e) => e.tenant_id === ids.tenant);
  if (!entitled)
    await c.admin.call("entitlement", {
      method: "PUT",
      path: `/admin/features/${ids.feature}/entitlements/${ids.tenant}`,
    });
  c.log(`entitlement ${c.plan.feature.key} → ${c.plan.tenant}: ${entitled ? "giữ nguyên" : "tạo"}`);
  const grants = await c.admin.call("grant", {
    path: `/admin/grants${qs({ tenant_id: ids.tenant, feature_id: ids.feature, group_id: ids.group, limit: 200 })}`,
  });
  const granted = (r: Obj) => (r.subject as Obj | undefined)?.id === ids.group;
  const has = items(grants).some(granted);
  if (!has)
    await c.admin.call("grant", {
      method: "POST",
      path: `/admin/grants${qs({ tenant_id: ids.tenant })}`,
      body: { feature_id: ids.feature, group_id: ids.group },
    });
  c.log(`grant ${c.plan.feature.key} → group ${c.plan.group.key}: ${has ? "giữ nguyên" : "tạo"}`);
}

/** Bước 9: grant agent `dify-chatbot` → group qua Hub `/agent-grants` (trùng ⇒ Hub trả 200, không đổi). */
export async function ensureAgentGrant(
  c: RunCtx,
  hub: Client,
  ids: { tenant: string; group: string },
): Promise<void> {
  const agentKey = c.plan.agent?.key as string;
  const r = await hub.call("agent-grant", {
    path: `/agent-grants${qs({ tenant_id: ids.tenant, subject_type: "group", subject_id: ids.group })}`,
  });
  const row = items(r).find((i) => (i.agent as Obj | undefined)?.key === agentKey);
  const agent = row?.agent as Obj | undefined;
  if (!agent || typeof agent.id !== "string")
    throw new SeedStepError("agent-grant", r.status, "AGENT_NOT_FOUND");
  const rows = Array.isArray(row?.grants) ? (row.grants as Obj[]) : [];
  if (rows.some((g) => (g.subject as Obj | undefined)?.id === ids.group)) {
    c.log(`agent ${agentKey} → group ${c.plan.group.key}: giữ nguyên`);
    return;
  }
  await hub.call("agent-grant", {
    method: "POST",
    path: `/agent-grants${qs({ tenant_id: ids.tenant })}`,
    body: { agent_id: agent.id, subject_type: "group", subject_id: ids.group },
  });
  c.log(`agent ${agentKey} → group ${c.plan.group.key}: grant`);
}
