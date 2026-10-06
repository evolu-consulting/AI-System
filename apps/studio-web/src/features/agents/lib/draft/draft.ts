// HUB-FR-60 · H4a-R03, R05, R12 · bản nháp form agent (chuỗi cho ô nhập) ⇄ payload API; validate bằng schema zod của contract
// (create/update), lỗi gắn trường theo `path` (cũng dùng cho `details.issues` của 400 VALIDATION_ERROR). Hàm thuần, không I/O.
import {
  type Agent,
  AgentCreateSchema,
  type AgentRuntime,
  agentUpdateSchemaFor,
} from "@ai/contracts/studio";

export type FieldKey =
  | "key"
  | "name.vi"
  | "name.en"
  | "description"
  | "profile_id"
  | "workflow_ids"
  | "bash_ack"
  | "timeout_s"
  | "token_budget"
  | "agent_type_key"
  | "max_turns"
  | "options_json";
export type FieldErrors = Partial<Record<FieldKey, string>>;

export type AgentDraft = {
  key: string;
  nameVi: string;
  nameEn: string;
  description: string;
  runtime: AgentRuntime;
  profileId: string;
  cli: string;
  tools: string[];
  mcp: boolean;
  cwdMode: string;
  maxTurns: string;
  timeout: string;
  tokenBudget: string;
  prompt: string;
  enabled: boolean;
  workflowIds: string[];
  agentTypeKey: string;
  /** `runtime_options` thô của agent `python` (F5 dựng bằng SchemaForm); giữ nguyên khi không sửa. */
  rawOptions: Record<string, unknown>;
  /** Id các ô JSON thô (SchemaForm) đang chứa JSON sai — chặn Lưu (`editor.err.json`). */
  badJson: string[];
  bashAck: boolean;
};

export const emptyDraft = (): AgentDraft => ({
  key: "",
  nameVi: "",
  nameEn: "",
  description: "",
  runtime: "llm",
  profileId: "",
  cli: "claude",
  tools: ["Read", "Grep"],
  mcp: false,
  cwdMode: "job",
  maxTurns: "",
  timeout: "600",
  tokenBudget: "",
  prompt: "",
  enabled: true,
  workflowIds: [],
  agentTypeKey: "",
  rawOptions: {},
  badJson: [],
  bashAck: false,
});

type CliOpts = {
  cli?: string;
  allowed_tools?: string[];
  mcp?: boolean;
  cwd_mode?: string;
  max_turns?: number;
};

/** Agent đã lưu có Bash trong tool được phép — sửa giữ Bash không cần xác nhận lại (R05). */
export const hadBash = (a: Pick<Agent, "runtime" | "runtime_options">): boolean =>
  a.runtime === "agentic-cli" &&
  ((a.runtime_options as CliOpts).allowed_tools ?? []).includes("Bash");

export function fromAgent(a: Agent): AgentDraft {
  const o = a.runtime_options as CliOpts;
  const base = emptyDraft();
  return {
    ...base,
    key: a.key,
    nameVi: a.name.vi,
    nameEn: a.name.en,
    description: a.description,
    runtime: a.runtime,
    profileId: a.profile_id ?? "",
    cli: o.cli ?? base.cli,
    tools: o.allowed_tools ?? base.tools,
    mcp: o.mcp ?? false,
    cwdMode: o.cwd_mode ?? base.cwdMode,
    maxTurns: o.max_turns === undefined ? "" : String(o.max_turns),
    timeout: String(a.timeout_s),
    tokenBudget: a.token_budget === null ? "" : String(a.token_budget),
    prompt: a.system_prompt,
    enabled: a.enabled,
    workflowIds: a.workflow_ids,
    agentTypeKey: a.agent_type_key ?? "",
    rawOptions: a.runtime === "python" ? a.runtime_options : {},
  };
}

/** Nhân bản (R12): Key trống, tên thêm hậu tố, agent tắt; chưa gọi API. */
export function cloneDraft(a: Agent, suffix: string): AgentDraft {
  const d = fromAgent(a);
  return {
    ...d,
    key: "",
    nameVi: `${d.nameVi} ${suffix}`,
    nameEn: `${d.nameEn} ${suffix}`,
    enabled: false,
  };
}

function runtimeFields(d: AgentDraft): Record<string, unknown> {
  const wf = d.workflowIds;
  switch (d.runtime) {
    case "agentic-cli": {
      const opts: CliOpts = { cli: d.cli, allowed_tools: d.tools, mcp: d.mcp, cwd_mode: d.cwdMode };
      if (d.maxTurns.trim() !== "") opts.max_turns = Number(d.maxTurns);
      return { profile_id: d.profileId, runtime_options: opts, workflow_ids: wf };
    }
    case "llm":
      return { profile_id: d.profileId, runtime_options: {}, workflow_ids: wf };
    case "python":
      return {
        profile_id: d.profileId || null,
        agent_type_key: d.agentTypeKey,
        runtime_options: d.rawOptions,
        workflow_ids: wf,
      };
    default:
      return { workflow_ids: wf }; // dify-*: không profile/runtime_options (lọc theo runtime, R03)
  }
}

/** Payload gửi đi; trường không áp dụng cho runtime bị lọc (vẫn giữ trong state). `version` có ⇒ PUT. */
export function toPayload(d: AgentDraft, version?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: { vi: d.nameVi, en: d.nameEn },
    description: d.description,
    system_prompt: d.prompt,
    timeout_s: d.timeout.trim() === "" ? Number.NaN : Number(d.timeout),
    token_budget: d.tokenBudget.trim() === "" ? null : Number(d.tokenBudget),
    enabled: d.enabled,
    ...runtimeFields(d),
  };
  if (d.runtime === "agentic-cli" && d.tools.includes("Bash") && d.bashAck) body.bash_ack = true;
  if (version !== undefined) return { ...body, version };
  return { key: d.key, runtime: d.runtime, ...body };
}

const PATHS: Record<string, FieldKey> = {
  key: "key",
  "name.vi": "name.vi",
  "name.en": "name.en",
  description: "description",
  profile_id: "profile_id",
  workflow_ids: "workflow_ids",
  bash_ack: "bash_ack",
  timeout_s: "timeout_s",
  token_budget: "token_budget",
  agent_type_key: "agent_type_key",
  "runtime_options.max_turns": "max_turns",
};

/** `path` (chuỗi "a.b" hoặc mảng) → trường form; `workflow_ids.0` ⇒ `workflow_ids`; không map được ⇒ null. */
export function fieldOfPath(path: unknown): FieldKey | null {
  const parts = (Array.isArray(path) ? path : String(path ?? "").split(".")).map(String);
  for (const n of [2, 1]) {
    const hit = PATHS[parts.slice(0, n).join(".")];
    if (hit) return hit;
  }
  return null;
}

export const FIELD_MESSAGE: Record<FieldKey, string> = {
  key: "editor.err.key",
  "name.vi": "editor.err.nameVi",
  "name.en": "editor.err.nameEn",
  description: "editor.err.description",
  profile_id: "editor.err.profile",
  workflow_ids: "editor.err.workflow",
  bash_ack: "editor.err.bashAck",
  timeout_s: "editor.err.timeout",
  token_budget: "editor.err.tokenBudget",
  agent_type_key: "editor.err.agentType",
  max_turns: "editor.err.maxTurns",
  options_json: "editor.err.json",
};

export type IssueLike = { path?: unknown };

/** Gắn issue vào trường; `unmapped` > 0 ⇒ nơi gọi hiện câu chung `editor.err.invalid`. */
export function mapIssues(issues: readonly IssueLike[]): { errors: FieldErrors; unmapped: number } {
  const errors: FieldErrors = {};
  let unmapped = 0;
  for (const i of issues) {
    const f = fieldOfPath(i.path);
    if (f) errors[f] ??= FIELD_MESSAGE[f];
    else unmapped++;
  }
  return { errors, unmapped };
}

export type ValidateCtx = { mode: "new" | "edit"; hadBash: boolean };

export function validateDraft(
  d: AgentDraft,
  ctx: ValidateCtx,
): { errors: FieldErrors; unmapped: number } {
  const payload = toPayload(d, ctx.mode === "edit" ? 1 : undefined);
  const r =
    ctx.mode === "edit"
      ? agentUpdateSchemaFor(d.runtime).safeParse(payload)
      : AgentCreateSchema.safeParse(payload);
  const out = r.success ? { errors: {} as FieldErrors, unmapped: 0 } : mapIssues(r.error.issues);
  if (d.runtime === "agentic-cli" && d.tools.includes("Bash") && !d.bashAck && !ctx.hadBash)
    out.errors.bash_ack = FIELD_MESSAGE.bash_ack;
  if (d.runtime === "python" && d.badJson.length > 0)
    out.errors.options_json = FIELD_MESSAGE.options_json;
  return out;
}

export const FIELD_ORDER: FieldKey[] = [
  "key",
  "name.vi",
  "name.en",
  "description",
  "profile_id",
  "agent_type_key",
  "max_turns",
  "options_json",
  "timeout_s",
  "token_budget",
  "workflow_ids",
  "bash_ack",
];

/** Cập nhật danh sách ô JSON thô đang sai (`draft.badJson`); không đổi ⇒ trả lại chính mảng cũ. */
export function markBadJson(list: readonly string[], id: string, bad: boolean): string[] {
  const has = list.includes(id);
  if (bad === has) return list as string[];
  return bad ? [...list, id] : list.filter((x) => x !== id);
}
