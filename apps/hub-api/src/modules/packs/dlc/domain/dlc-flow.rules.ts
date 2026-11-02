// dlc-engine · khe DLC của thư viện quy trình (`dlc.new-system`, `dlc.enhancement`, `dlc.bug-fix`): `slot_body` = các BƯỚC DLC
// (`kind: "dlc"`). Một bước DLC = một việc của dây chuyền (khởi tạo, spec, QC, chuẩn bị đội, build theo queue, nghiệm thu, báo
// cáo, deploy) hoặc một agent tuỳ ý; cổng duyệt của bước (Đạt / Chưa đạt + quay lại bước trước) do ENGINE giữ (`after.review`,
// `back_to_steps`). Biên dịch: mỗi bước ⇒ một stage `tool` (`dlc-step`, tham số hằng) ở bước engine = vị trí; `stage.slot` = bước
// nguyên vẹn ⇒ `fromStages` dựng lại body từ canvas. Bước duyệt (`review` của khe hợp đồng) KHÔNG trộn được với bước DLC (một
// sơ đồ chỉ một loại). Thuần, lớp 1 (chỉ builtin).

export const DLC_PACK = "dlc";
export const DLC_MODES = ["new-system", "enhancement", "bug-fix"] as const;
export type DlcMode = (typeof DLC_MODES)[number];

/** Khe theo dây chuyền; nhãn hiện ở thư viện quy trình. */
export const DLC_SLOTS: Readonly<Record<DlcMode, { key: string; label: string; name: string }>> = {
  "new-system": { key: "dlc.new-system", label: "DLC · New System", name: "New System" },
  enhancement: { key: "dlc.enhancement", label: "DLC · Enhancement", name: "Enhancement" },
  "bug-fix": { key: "dlc.bug-fix", label: "DLC · Bug Fix", name: "Bug Fix" },
};
export const dlcModeOfSlot = (slot: string): DlcMode | null =>
  DLC_MODES.find((m) => DLC_SLOTS[m].key === slot) ?? null;
/** Def tenant mà lượt DLC chạy (`ensureDef` theo khe). */
export const dlcProcessKey = (mode: DlcMode): string => `dlc-${mode}`;

/**
 * Việc của bước: `intake` (project workspace + ticket + spec đầu vào), `spec` (agent spec: hỏi, plan + đội), `qc` (agent QC:
 * test case + script test), `setup` (sinh agent domain/QC + queue), `build` (queue tuần tự: agent domain + merge + cổng test),
 * `verify` (agent nghiệm thu 100% spec; thiếu ⇒ việc sửa + build lại), `report` (báo cáo + ticket chờ deploy), `deploy`
 * (deploy bản đã merge), `agent` (agent bất kỳ làm `instruction`).
 */
export const DLC_ACTIONS = [
  "intake",
  "spec",
  "qc",
  "setup",
  "build",
  "verify",
  "report",
  "deploy",
  "agent",
] as const;
export type DlcAction = (typeof DLC_ACTIONS)[number];

/** Việc gọi agent (có `agent_key`); vắng ⇒ agent mặc định của việc. */
export const DLC_DEFAULT_AGENT: Readonly<Partial<Record<DlcAction, string>>> = {
  spec: "dlc-spec",
  qc: "dlc-qc",
  verify: "dlc-verify",
};
const AGENT_ACTIONS: ReadonlySet<DlcAction> = new Set(["spec", "qc", "verify", "agent"]);
export const dlcActionUsesAgent = (a: DlcAction): boolean => AGENT_ACTIONS.has(a);

/** Việc phải có việc khác đứng TRƯỚC trong cùng sơ đồ (dây chuyền chạy theo thứ tự này). */
const NEEDS: Readonly<Partial<Record<DlcAction, readonly DlcAction[]>>> = {
  qc: ["spec"],
  setup: ["spec"],
  build: ["setup"],
  verify: ["build"],
  deploy: ["build"],
};

export const DLC_GROUP_EDITOR = "dlc-editor";
export const DLC_GROUP_OWNER = "dlc-owner";
export const DLC_STEPS_MAX = 10; // = PROCESS_STAGES_MAX của engine (mỗi bước một stage)
export const DLC_ROUNDS = { min: 1, max: 10, default: 3 } as const;
/** Hạn mỗi bước (phút) — build / nghiệm thu chạy nhiều giờ. */
export const DLC_TIMEOUT_MIN = { min: 5, max: 1440, default: 60 } as const;
export const DLC_INSTRUCTION_MAX = 8_000;
const KEY_RE = /^[a-z0-9-]{1,32}$/;
const GROUP_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NAME_MAX = 80;

export type DlcGate = { group_key: string; back_to: string[] };
export type DlcStep = {
  kind: "dlc";
  key: string;
  name: string;
  action: DlcAction;
  /** Agent Hub (khoá) cho việc gọi agent; null ⇒ mặc định của việc. */
  agent_key: string | null;
  /** Lời dặn thêm cho agent (việc `agent`: toàn bộ yêu cầu). */
  instruction: string;
  /** null ⇒ chạy tiếp không chờ người. */
  gate: DlcGate | null;
  /** build: số lần thử mỗi việc; verify: số vòng sửa; còn lại bỏ qua. */
  max_rounds: number;
  timeout_min: number;
};
export type DlcBody = { steps: DlcStep[] };

export type DlcIssueRule =
  | "SLOT_SHAPE"
  | "KIND_MIX"
  | "STEPS_RANGE"
  | "KEY_INVALID"
  | "KEY_DUPLICATE"
  | "NAME_REQUIRED"
  | "ACTION_INVALID"
  | "AGENT_REQUIRED"
  | "ORDER_INVALID"
  | "GATE_GROUP_INVALID"
  | "BACK_TARGET_INVALID"
  | "ROUNDS_INVALID"
  | "TIMEOUT_INVALID"
  | "INSTRUCTION_TOO_LONG";
export type DlcIssue = { path: string; rule: DlcIssueRule };

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
const isAction = (a: unknown): a is DlcAction =>
  typeof a === "string" && (DLC_ACTIONS as readonly string[]).includes(a);

/** Hình tối thiểu (`steps` là mảng object); chi tiết từng trường ở `validateDlcBody`. Sai ⇒ null. */
export function dlcBodyOf(x: unknown): DlcBody | null {
  if (!isObj(x) || !Array.isArray(x.steps) || !x.steps.every(isObj)) return null;
  return x as unknown as DlcBody;
}

function gateIssues(s: DlcStep, i: number, earlier: ReadonlySet<string>): DlcIssue[] {
  if (s.gate === null) return [];
  const p = `steps.${i}.gate`;
  if (
    !isObj(s.gate) ||
    typeof s.gate.group_key !== "string" ||
    !GROUP_KEY_RE.test(s.gate.group_key)
  )
    return [{ path: `${p}.group_key`, rule: "GATE_GROUP_INVALID" }];
  const back = Array.isArray(s.gate.back_to) ? s.gate.back_to : null;
  if (!back) return [{ path: `${p}.back_to`, rule: "BACK_TARGET_INVALID" }];
  const bad = back.findIndex((k) => typeof k !== "string" || !earlier.has(k));
  if (bad >= 0 || new Set(back).size !== back.length)
    return [{ path: `${p}.back_to.${Math.max(bad, 0)}`, rule: "BACK_TARGET_INVALID" }];
  return [];
}

/** Luật của một bước (đã biết là `kind: "dlc"`); `earlier` = khoá các bước đứng trước, `actions` = việc đứng trước. */
function stepIssues(
  s: DlcStep,
  i: number,
  earlier: ReadonlySet<string>,
  actions: ReadonlySet<DlcAction>,
): DlcIssue[] {
  const p = `steps.${i}`;
  if (typeof s.key !== "string" || !KEY_RE.test(s.key))
    return [{ path: `${p}.key`, rule: "KEY_INVALID" }];
  if (earlier.has(s.key)) return [{ path: `${p}.key`, rule: "KEY_DUPLICATE" }];
  if (typeof s.name !== "string" || !s.name.trim() || s.name.length > NAME_MAX)
    return [{ path: `${p}.name`, rule: "NAME_REQUIRED" }];
  if (!isAction(s.action)) return [{ path: `${p}.action`, rule: "ACTION_INVALID" }];
  if (s.action === "agent" && !(typeof s.agent_key === "string" && s.agent_key.trim()))
    return [{ path: `${p}.agent_key`, rule: "AGENT_REQUIRED" }];
  const need = NEEDS[s.action] ?? [];
  if (need.some((a) => !actions.has(a))) return [{ path: `${p}.action`, rule: "ORDER_INVALID" }];
  if (typeof s.instruction !== "string" || s.instruction.length > DLC_INSTRUCTION_MAX)
    return [{ path: `${p}.instruction`, rule: "INSTRUCTION_TOO_LONG" }];
  if (!isInt(s.max_rounds, DLC_ROUNDS.min, DLC_ROUNDS.max))
    return [{ path: `${p}.max_rounds`, rule: "ROUNDS_INVALID" }];
  if (!isInt(s.timeout_min, DLC_TIMEOUT_MIN.min, DLC_TIMEOUT_MIN.max))
    return [{ path: `${p}.timeout_min`, rule: "TIMEOUT_INVALID" }];
  return gateIssues(s, i, earlier);
}

/**
 * `SlotSpec.validate` của khe DLC: hình → loại bước (bước không phải `dlc` ⇒ `KIND_MIX`: bước duyệt và bước DLC không nối với
 * nhau trong một sơ đồ) → số bước → từng bước theo thứ tự (khoá, tên, việc, agent, thứ tự dây chuyền, vòng, hạn, cổng duyệt).
 * Trả lỗi ĐẦU TIÊN mỗi bước; rỗng ⇒ hợp lệ.
 */
export function validateDlcBody(x: unknown): DlcIssue[] {
  const body = dlcBodyOf(x);
  if (!body) return [{ path: "steps", rule: "SLOT_SHAPE" }];
  const mixed = body.steps.findIndex((s) => s.kind !== "dlc");
  if (mixed >= 0) return [{ path: `steps.${mixed}.kind`, rule: "KIND_MIX" }];
  if (body.steps.length < 1 || body.steps.length > DLC_STEPS_MAX)
    return [{ path: "steps", rule: "STEPS_RANGE" }];
  const out: DlcIssue[] = [];
  const keys = new Set<string>();
  const actions = new Set<DlcAction>();
  body.steps.forEach((s, i) => {
    out.push(...stepIssues(s, i, keys, actions));
    if (typeof s.key === "string") keys.add(s.key);
    if (isAction(s.action)) actions.add(s.action);
  });
  return out;
}

/** Mã Group duyệt mà body tham chiếu (kiểm theo tenant khi gán / xuất bản). */
export function dlcGroupKeys(body: DlcBody): string[] {
  const keys = new Set<string>();
  for (const s of body.steps) if (s.gate) keys.add(s.gate.group_key);
  return [...keys];
}

export const DLC_TOOL_KEY = "dlc-step";
const STAGE_TEMPLATE = "# {name}\n\n## Kết quả\n";
/** Trường output của tool `dlc-step` (bảng "Kết quả" của stage; nội dung dài nằm trong hội thoại + workspace). */
export const DLC_OUTPUT_FIELDS = [
  { key: "status", type: "string", required: true },
  { key: "summary", type: "string", required: false },
  { key: "project", type: "string", required: false },
] as const;

/** Tham số hằng của tool `dlc-step` cho bước (chế độ dây chuyền theo khe). */
export function dlcToolArgs(
  s: DlcStep,
  mode: DlcMode,
): Record<string, { from: "const"; value: string | number }> {
  const c = (value: string | number) => ({ from: "const" as const, value });
  return {
    action: c(s.action),
    mode: c(mode),
    step: c(s.key),
    agent: c(s.agent_key ?? DLC_DEFAULT_AGENT[s.action] ?? ""),
    instruction: c(s.instruction),
    rounds: c(s.max_rounds),
  };
}

/** Bước engine của cổng duyệt: Group theo MÃ (def thư viện), quay lại = vị trí các bước `back_to`. */
function afterOf(s: DlcStep, body: DlcBody) {
  if (!s.gate) return { kind: "auto", branch: [] };
  const idx = (k: string) => body.steps.findIndex((x) => x.key === k);
  return {
    kind: "review",
    group_id: null,
    group_key: s.gate.group_key,
    ...(s.gate.group_key === DLC_GROUP_OWNER ? {} : { also_group_keys: [DLC_GROUP_OWNER] }),
    back_to_steps: s.gate.back_to.map(idx).filter((n) => n >= 0),
    remind_every_h: null,
    escalate: null,
    branch: [],
    exclude_starter: false,
  };
}

/** `SlotSpec.compile`: body hợp lệ ⇒ stages def thư viện (một stage `tool` mỗi bước). Ném khi body sai hình. */
export function compileDlcStages(x: unknown, mode: DlcMode): Record<string, unknown>[] {
  const body = dlcBodyOf(x);
  if (!body) throw new Error("dlc-slot-shape");
  return body.steps.map((s, i) => ({
    key: s.key,
    name: s.name,
    step: i,
    executor: { kind: "tool", tool_key: DLC_TOOL_KEY, args: dlcToolArgs(s, mode) },
    instruction: "",
    output: {
      filename: `${s.key}.md`,
      template: STAGE_TEMPLATE,
      required_sections: ["Kết quả"],
      fields: DLC_OUTPUT_FIELDS.map((f) => ({ ...f })),
    },
    after: afterOf(s, body),
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: s.timeout_min * 60,
    token_budget: null,
    slot: { ...s },
  }));
}

/** Def tenant của lượt DLC (key `dlc-<mode>`) từ stages đã phân giải Group theo tenant. */
export function dlcProcessDef(mode: DlcMode, stages: readonly unknown[]): Record<string, unknown> {
  return {
    key: dlcProcessKey(mode),
    name: `DLC · ${DLC_SLOTS[mode].name}`,
    description: `Dây chuyền AI SDLC ${DLC_SLOTS[mode].name}: agent làm từng bước, người duyệt ở các cổng.`,
    input_hint: "Yêu cầu / ticket",
    run_group_ids: [] as string[],
    token_budget: null,
    enabled: true,
    sources: [] as string[],
    inputs: [],
    ttl_days: null,
    stages,
  };
}

/** `SlotSpec.fromStages` (lưu từ canvas): mọi stage phải mang bước DLC ở `slot`; stage khác ⇒ khoá stage sai đầu tiên. */
export function dlcBodyFromStages(
  stages: readonly unknown[],
): { body: DlcBody } | { stage: string } {
  const steps: DlcStep[] = [];
  for (const st of stages) {
    const s = isObj(st) ? st : {};
    const slot = isObj(s.slot) ? s.slot : null;
    if (slot?.kind !== "dlc") return { stage: String(s.key ?? "") };
    steps.push({
      ...(slot as unknown as DlcStep),
      key: String(s.key ?? slot.key),
      name: String(s.name ?? slot.name),
    });
  }
  return { body: { steps } };
}

/** Thay mã Group duyệt bằng id theo tenant (`ids`: mã → id); mã thiếu ⇒ null (lượt không mở được). */
export function resolveDlcStages(
  stages: readonly Record<string, unknown>[],
  ids: ReadonlyMap<string, string>,
): Record<string, unknown>[] | null {
  let miss = false;
  const out = stages.map((s) => {
    const a = isObj(s.after) ? s.after : null;
    if (a?.kind !== "review") return s;
    const { group_key, also_group_keys, ...rest } = a as Record<string, unknown> & {
      group_key?: string;
      also_group_keys?: string[];
    };
    const gid = group_key ? ids.get(group_key) : undefined;
    if (!gid) miss = true;
    const also = (also_group_keys ?? []).map((k) => ids.get(k)).filter((v): v is string => !!v);
    return {
      ...s,
      after: { ...rest, group_id: gid ?? null, ...(also.length ? { also_group_ids: also } : {}) },
    };
  });
  return miss ? null : out;
}

/** Bước mặc định khi admin bấm "Thêm bước DLC" (việc `agent`, chưa chọn agent ⇒ form báo thiếu). */
export function newDlcStep(key: string, name: string): DlcStep {
  return {
    kind: "dlc",
    key,
    name,
    action: "agent",
    agent_key: null,
    instruction: "",
    gate: null,
    max_rounds: DLC_ROUNDS.default,
    timeout_min: DLC_TIMEOUT_MIN.default,
  };
}

/** Sơ đồ mặc định của mỗi dây chuyền (seed thư viện): giống flow DLC cũ trên Dify, cổng duyệt do engine giữ. */
export function defaultDlcBody(mode: DlcMode): DlcBody {
  const g = (back_to: string[] = []): DlcGate => ({ group_key: DLC_GROUP_EDITOR, back_to });
  const s = (
    key: string,
    name: string,
    action: DlcAction,
    o: Partial<Pick<DlcStep, "gate" | "max_rounds" | "timeout_min">> = {},
  ): DlcStep => ({
    kind: "dlc",
    key,
    name,
    action,
    agent_key: null,
    instruction: "",
    gate: o.gate ?? null,
    max_rounds: o.max_rounds ?? DLC_ROUNDS.default,
    timeout_min: o.timeout_min ?? DLC_TIMEOUT_MIN.default,
  });
  return {
    steps: [
      s("intake", "Khởi tạo", "intake", { timeout_min: 10 }),
      s("spec", mode === "bug-fix" ? "Phân tích lỗi + plan" : "Spec + plan", "spec", {
        gate: g(),
        timeout_min: 240,
      }),
      s("qc", "Test case + script test", "qc", { gate: g(["spec"]), timeout_min: 240 }),
      s("setup", "Chuẩn bị đội + queue", "setup", { timeout_min: 10 }),
      s("build", "Build theo queue", "build", { max_rounds: 3, timeout_min: 1440 }),
      s("verify", "Nghiệm thu", "verify", { max_rounds: 1, timeout_min: 1440 }),
      s("report", "Báo cáo · duyệt deploy", "report", { gate: g(["build"]), timeout_min: 10 }),
      s("deploy", "Deploy", "deploy", { timeout_min: 60 }),
    ],
  };
}
