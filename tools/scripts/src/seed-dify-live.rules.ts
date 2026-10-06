// ADM-FR-21 · HUB-FR-89 · X1-R01..R05, R14 · luật thuần `seed:dify` (plan X1 §5.2): danh sách trắng env, cờ CLI, kế hoạch
// (không bao giờ chứa key), patch chỉ trường khác (idempotent), bản in dry-run.
import {
  API_URL_VAR,
  APPS,
  type AppSpec,
  CHATBOT_AGENT,
  type CommandSpec,
  ENV_KEY,
  FEATURE,
  GROUP_MEMBERS,
  type Localized,
  SEED_APPS,
  type SeedApp,
  type WorkflowSpec,
} from "./seed-dify-live.apps";

export { ENV_KEY, SEED_APPS, type SeedApp };

export type SeedArgs = {
  apply: boolean;
  apps: SeedApp[];
  tenant: string;
  group: string;
  rotateSecrets: boolean;
};
export type SeedEnv =
  | { ok: true; apiUrl: string; keys: ReadonlyMap<SeedApp, string> }
  | { ok: false; missing: string[] };

export type WorkflowWant = WorkflowSpec & {
  base_url: string;
  side_effect: false;
  secret_name: string;
};
export type CommandWant = CommandSpec & { mode: "sync"; workflow_key: string };
export type SeedPlan = {
  mode: "apply" | "dry-run";
  tenant: string;
  group: { key: string; name: Localized; description: string; members: string[] };
  feature: { key: string; name: Localized };
  rotate_secrets: boolean;
  secrets: { name: string; app: SeedApp }[];
  workflows: WorkflowWant[];
  commands: CommandWant[];
  agent: { key: string; workflow_key: string } | null;
};
/** Bản rút gọn của dữ liệu đọc từ API để so sánh (chỉ trường seed quản lý). */
export type WorkflowLite = Record<string, unknown>;
export type CommandLite = Record<string, unknown>;

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote(raw: string): string {
  const v = raw.trim();
  const q = v[0];
  if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) return v.slice(1, -1);
  return v;
}

/**
 * X1-R05: chỉ giữ `DIFY_API_URL` + `ENV_KEY[app]` của app được chọn; mọi dòng khác (console, agent, app khác) bị bỏ
 * ngay khi tách dòng, không bao giờ vào bộ nhớ kết quả. Thiếu ⇒ chỉ nêu tên biến.
 */
export function parseSeedEnv(text: string, apps: readonly SeedApp[]): SeedEnv {
  const wanted = new Set<string>([API_URL_VAR, ...apps.map((a) => ENV_KEY[a])]);
  const found = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (!m || !wanted.has(m[1] as string)) continue;
    const v = unquote(m[2] as string);
    if (v) found.set(m[1] as string, v);
  }
  const apiUrl = found.get(API_URL_VAR);
  const missing: string[] = [];
  if (!apiUrl || !/^https?:\/\//.test(apiUrl)) missing.push(API_URL_VAR);
  for (const a of apps) if (!found.has(ENV_KEY[a])) missing.push(ENV_KEY[a]);
  if (missing.length || !apiUrl) return { ok: false, missing };
  const keys = new Map<SeedApp, string>(apps.map((a) => [a, found.get(ENV_KEY[a]) as string]));
  return { ok: true, apiUrl, keys };
}

function parseApps(v: string | undefined): SeedApp[] | { error: string } {
  const names = (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return { error: "--apps cần danh sách app, vd --apps translate,chatbot" };
  const bad = names.filter((n) => !(SEED_APPS as readonly string[]).includes(n));
  if (bad.length)
    return { error: `app không hợp lệ: ${bad.join(", ")} (hợp lệ: ${SEED_APPS.join(", ")})` };
  return SEED_APPS.filter((a) => names.includes(a));
}

function splitFlag(argv: string[]): { flag: string; value?: string }[] {
  const out: { flag: string; value?: string }[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const eq = a.indexOf("=");
    if (eq > 0) out.push({ flag: a.slice(0, eq), value: a.slice(eq + 1) });
    else if (["--apps", "--tenant", "--group"].includes(a)) out.push({ flag: a, value: argv[++i] });
    else out.push({ flag: a });
  }
  return out;
}

/** `--apply` (mặc định dry-run), `--apps a,b`, `--tenant`, `--group`, `--rotate-secrets`. Cờ lạ ⇒ lỗi. */
export function parseSeedArgs(argv: string[]): SeedArgs | { error: string } {
  const r: SeedArgs = {
    apply: false,
    apps: [...SEED_APPS],
    tenant: "acme",
    group: "dify-demo",
    rotateSecrets: false,
  };
  for (const f of splitFlag(argv)) {
    const err = applyFlag(r, f);
    if (err) return { error: err };
  }
  return r;
}

const SWITCHES: Record<string, (r: SeedArgs) => void> = {
  "--apply": (r) => {
    r.apply = true;
  },
  "--dry-run": (r) => {
    r.apply = false;
  },
  "--rotate-secrets": (r) => {
    r.rotateSecrets = true;
  },
};

/** Áp một cờ vào `r`; trả thông báo lỗi hoặc `null`. */
function applyFlag(r: SeedArgs, { flag, value }: { flag: string; value?: string }): string | null {
  const sw = SWITCHES[flag];
  if (sw) {
    sw(r);
    return null;
  }
  if (flag === "--apps") {
    const apps = parseApps(value);
    if ("error" in apps) return apps.error;
    r.apps = apps;
    return null;
  }
  if (flag !== "--tenant" && flag !== "--group") return `cờ không hỗ trợ: ${flag}`;
  if (!value || !KEY_RE.test(value)) return `${flag} cần key hợp lệ (a-z, 0-9, -)`;
  r[flag === "--tenant" ? "tenant" : "group"] = value;
  return null;
}

function workflowWant(spec: AppSpec, app: SeedApp, apiUrl: string): WorkflowWant {
  return { ...spec.workflow, base_url: apiUrl, side_effect: false, secret_name: ENV_KEY[app] };
}

/** Kế hoạch đầy đủ — đầu vào không có key (X1-R04), nên plan/bản in không thể chứa key. */
export function buildSeedPlan(a: SeedArgs, apiUrl: string): SeedPlan {
  const commands: CommandWant[] = [];
  for (const app of a.apps) {
    const c = APPS[app].command;
    if (c) commands.push({ ...c, mode: "sync", workflow_key: APPS[app].workflow.key });
  }
  return {
    mode: a.apply ? "apply" : "dry-run",
    tenant: a.tenant,
    group: {
      key: a.group,
      name: { vi: "Dify demo", en: "Dify demo" },
      description: "Nhóm dùng thử app Dify thật (seed:dify X1)",
      members: [...GROUP_MEMBERS],
    },
    feature: { key: FEATURE.key, name: { ...FEATURE.name } },
    rotate_secrets: a.rotateSecrets,
    secrets: a.apps.map((app) => ({ name: ENV_KEY[app], app })),
    workflows: a.apps.map((app) => workflowWant(APPS[app], app, apiUrl)),
    commands,
    agent: a.apps.includes("chatbot")
      ? { key: CHATBOT_AGENT.key, workflow_key: CHATBOT_AGENT.workflow_key }
      : null,
  };
}

/** JSON chuẩn hoá (khoá sắp, bỏ `undefined`) để so sánh sâu không phụ thuộc thứ tự khoá. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

function patchOf(
  managed: readonly string[],
  cur: Record<string, unknown>,
  want: Record<string, unknown>,
): Record<string, unknown> | null {
  const p: Record<string, unknown> = {};
  for (const k of managed)
    if (k in want && canonical(cur[k]) !== canonical(want[k])) p[k] = want[k];
  return Object.keys(p).length ? p : null;
}

const WF_MANAGED = [
  "name",
  "description",
  "app_type",
  "base_url",
  "secret_id",
  "input_schema",
  "output_field",
  "side_effect",
] as const;
const CMD_MANAGED = ["description", "args", "input_map", "output", "mode", "timeout_s"] as const;

/** X1-R14: chỉ trường seed quản lý mà khác; giống hết ⇒ `null` (không PATCH, không audit). `key` bất biến. */
export function workflowPatch(
  cur: WorkflowLite,
  want: WorkflowLite,
): Record<string, unknown> | null {
  return patchOf(WF_MANAGED, cur, want);
}

/** Như `workflowPatch`; không đụng `name`/`aliases`/`feature_ids`/`enabled` (người dùng có thể đã chỉnh). */
export function commandPatch(cur: CommandLite, want: CommandLite): Record<string, unknown> | null {
  return patchOf(CMD_MANAGED, cur, want);
}

function mapText(m: CommandSpec["input_map"]): string {
  return Object.entries(m)
    .map(([k, e]) => `${k}←${"value" in e ? `${e.source}:${e.value}` : e.source}`)
    .join(", ");
}

/** Bản in dry-run: tên/loại/input map, không key, không URL (X1-R04, §5.4). */
export function formatPlan(p: SeedPlan): string {
  const L: string[] = [
    `seed:dify — ${p.mode === "apply" ? "GHI (--apply)" : "DRY-RUN (không ghi gì; thêm --apply để ghi)"}`,
    `tenant ${p.tenant} · group ${p.group.key} (thành viên: ${p.group.members.join(", ")}) · feature ${p.feature.key}`,
    `secret (${p.rotate_secrets ? "tạo hoặc xoay" : "tạo nếu vắng, có rồi thì giữ"}): ${p.secrets.map((s) => s.name).join(", ")}`,
    "workflow (tạo nếu vắng, cập nhật nếu khác, side_effect=false):",
  ];
  for (const w of p.workflows)
    L.push(
      `  - ${w.key} [${w.app_type}] input: ${w.input_schema.map((i) => i.name).join(", ")} · secret ${w.secret_name}`,
    );
  L.push("command (tạo nếu vắng, gắn feature; trùng tên với workflow khác ⇒ bỏ qua + cảnh báo):");
  for (const c of p.commands)
    L.push(
      `  - /${c.name} → ${c.workflow_key} · args: ${c.args.map((x) => x.name).join(", ")} · map: ${mapText(c.input_map)} · output ${c.output.field}`,
    );
  L.push(
    `entitlement feature ${p.feature.key} → ${p.tenant}; grant feature → group ${p.group.key}`,
  );
  L.push(
    p.agent
      ? `Hub: agent ${p.agent.key} (runtime dify-agent, workflow ${p.agent.workflow_key}) + entitlement ${p.tenant} qua hub:seed; grant agent → group ${p.group.key}`
      : "Hub: bỏ qua agent (không chọn app chatbot)",
  );
  return L.join("\n");
}
