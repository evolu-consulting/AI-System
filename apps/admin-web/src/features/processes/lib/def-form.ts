// ADM-FR-66 · CR-056 · P-a F5: mô hình form của editor quy trình (bản nháp ↔ `ProcessDefInput`) và validate client khớp
// contract (plan-frontend-admin §2). Hàm thuần: không React, không gọi API.
import {
  FIELD_KEY_RE,
  OUTPUT_FILENAME_RE,
  PROCESS_DESC_MAX,
  PROCESS_KEY_RE,
  PROCESS_NAME_MAX,
  PROCESS_RUN_GROUPS_MAX,
  PROCESS_STAGES_MAX,
  type ProcessDef,
  type ProcessDefInput,
  type ProcessStageDef,
  STAGE_FIELDS_MAX,
  STAGE_INSTRUCTION_MAX,
  STAGE_KEY_RE,
  STAGE_SECTIONS_MAX,
  STAGE_TEMPLATE_MAX,
  STAGE_TIMEOUT_S,
  STAGE_TOKEN_BUDGET,
} from "@ai/contracts/hub-admin";
import {
  type InputDraft,
  inputsToDef,
  inputsToDraft,
  mustKnowToDef,
  mustKnowToDraft,
  type StageSourceDraft,
  stageSourcesToDef,
  stageSourcesToDraft,
  validateSourcesPart,
} from "./sources-form";

export type FieldDraft = { key: string; type: "number" | "string" | "date"; required: boolean };
export type StageDraft = {
  /** Khoá React cục bộ (không gửi đi). */
  uid: string;
  /** Mã giai đoạn còn tự sinh từ tên (người dùng chưa sửa tay). */
  keyAuto: boolean;
  key: string;
  name: string;
  /** `agent:<id>` | `team:<id>` | "" (chưa chọn). */
  executor: string;
  instruction: string;
  filename: string;
  template: string;
  sections: string[];
  fields: FieldDraft[];
  after: "review" | "auto";
  groupId: string;
  real: boolean;
  answerer: "starter" | "group" | "user";
  answererId: string;
  timeout: string;
  budget: string;
  /** Nguồn dùng + allowlist (textarea) — `sources-form`. */
  sources: StageSourceDraft[];
  /** `must_know`, mỗi dòng một mục. */
  mustKnow: string;
};
export type DefDraft = {
  key: string;
  name: string;
  description: string;
  hint: string;
  groupIds: string[];
  budget: string;
  enabled: boolean;
  stages: StageDraft[];
  /** Khoá nguồn của quy trình (≤ 20). */
  sources: string[];
  inputs: InputDraft[];
};
/** path (`stages.0.output.filename`) → khoá i18n của câu lỗi. */
export type DraftErrors = Record<string, string>;

let seq = 0;
const nextUid = (): string => `s${++seq}`;

export function emptyStage(): StageDraft {
  return {
    uid: nextUid(),
    keyAuto: true,
    key: "",
    name: "",
    executor: "",
    instruction: "",
    filename: "",
    template: "",
    sections: [],
    fields: [],
    after: "auto",
    groupId: "",
    real: false,
    answerer: "starter",
    answererId: "",
    timeout: String(STAGE_TIMEOUT_S.default),
    budget: "",
    sources: [],
    mustKnow: "",
  };
}

export const emptyDraft = (): DefDraft => ({
  key: "",
  name: "",
  description: "",
  hint: "",
  groupIds: [],
  budget: "",
  enabled: false,
  stages: [emptyStage()],
  sources: [],
  inputs: [],
});

const num = (v: number | null): string => (v === null ? "" : String(v));

function stageToDraft(s: ProcessStageDef): StageDraft {
  const a = s.answerer;
  return {
    uid: nextUid(),
    keyAuto: false,
    key: s.key,
    name: s.name,
    executor:
      s.executor.kind === "agent" ? `agent:${s.executor.agent_id}` : `team:${s.executor.team_id}`,
    instruction: s.instruction,
    filename: s.output.filename,
    template: s.output.template,
    sections: [...s.output.required_sections],
    fields: s.output.fields.map((f) => ({ ...f })),
    after: s.after.kind,
    groupId: s.after.kind === "review" ? (s.after.group_id ?? "") : "",
    real: s.real_action,
    answerer: a.kind,
    answererId: a.kind === "group" ? a.group_id : a.kind === "user" ? a.user_id : "",
    timeout: String(s.timeout_s),
    budget: num(s.token_budget),
    sources: stageSourcesToDraft(s.sources),
    mustKnow: mustKnowToDraft(s.must_know),
  };
}

export function toDraft(d: ProcessDefInput | ProcessDef): DefDraft {
  return {
    key: d.key,
    name: d.name,
    description: d.description,
    hint: d.input_hint,
    groupIds: [...d.run_group_ids],
    budget: num(d.token_budget),
    enabled: d.enabled,
    stages: d.stages.map(stageToDraft),
    sources: [...d.sources],
    inputs: inputsToDraft(d.inputs),
  };
}

const intOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s.trim()));

function stageToInput(s: StageDraft): ProcessStageDef {
  const [kind, id = ""] = s.executor.split(":");
  return {
    key: s.key,
    name: s.name.trim(),
    executor: kind === "team" ? { kind: "team", team_id: id } : { kind: "agent", agent_id: id },
    instruction: s.instruction,
    output: {
      filename: s.filename,
      template: s.template,
      required_sections: s.sections,
      fields: s.fields,
    },
    after:
      s.after === "review" ? { kind: "review", group_id: s.groupId || null } : { kind: "auto" },
    real_action: s.real,
    answerer:
      s.answerer === "group"
        ? { kind: "group", group_id: s.answererId }
        : s.answerer === "user"
          ? { kind: "user", user_id: s.answererId }
          : { kind: "starter" },
    timeout_s: Number(s.timeout),
    token_budget: intOrNull(s.budget),
    sources: stageSourcesToDef(s.sources),
    must_know: mustKnowToDef(s.mustKnow),
  };
}

/** Bản nháp (đã qua `validateDraft`) → body gửi Hub. */
export function toInput(d: DefDraft): ProcessDefInput {
  return {
    key: d.key,
    name: d.name.trim(),
    description: d.description,
    input_hint: d.hint,
    run_group_ids: d.groupIds,
    stages: d.stages.map(stageToInput),
    token_budget: intOrNull(d.budget),
    enabled: d.enabled,
    sources: d.sources,
    inputs: inputsToDef(d.inputs),
  };
}

/** Mã giai đoạn gợi ý từ tên: bỏ dấu, chữ thường, `-`; trùng ⇒ thêm `-2`, `-3`… */
export function slugKey(name: string, taken: readonly string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "stage";
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}-${n}`;
  return key;
}

/** Giai đoạn `i` có được bật "Hành động thật"? Cần giai đoạn ngay trước có người kiểm. */
export const canRealAction = (stages: readonly StageDraft[], i: number): boolean =>
  i > 0 && stages[i - 1]?.after === "review";

export function moveStage<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return [...list];
  const out = [...list];
  const a = out[i] as T;
  out[i] = out[j] as T;
  out[j] = a;
  return out;
}

const P = "process.admin.validate.";
const inRange = (s: string, min: number, max: number): boolean => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
};
const budgetOk = (s: string): boolean =>
  s.trim() === "" || inRange(s, STAGE_TOKEN_BUDGET.min, STAGE_TOKEN_BUDGET.max);

function validateOutput(s: StageDraft, at: (f: string) => string, e: DraftErrors) {
  if (!OUTPUT_FILENAME_RE.test(s.filename)) e[at("output.filename")] = `${P}fileName`;
  if (s.template.length < 1 || s.template.length > STAGE_TEMPLATE_MAX)
    e[at("output.template")] = s.template.length < 1 ? `${P}templateRequired` : `${P}tooLong`;
  if (s.sections.length < 1 || s.sections.length > STAGE_SECTIONS_MAX)
    e[at("output.required_sections")] = `${P}sectionRequired`;
  if (s.fields.length > STAGE_FIELDS_MAX) e[at("output.fields")] = `${P}tooMany`;
  s.fields.forEach((f, j) => {
    if (!FIELD_KEY_RE.test(f.key)) e[at(`output.fields.${j}.key`)] = `${P}fieldKey`;
  });
}

function validateStage(s: StageDraft, i: number, all: readonly StageDraft[], e: DraftErrors) {
  const at = (f: string) => `stages.${i}.${f}`;
  if (s.name.trim() === "" || s.name.trim().length > PROCESS_NAME_MAX)
    e[at("name")] = `${P}nameRequired`;
  if (!STAGE_KEY_RE.test(s.key)) e[at("key")] = `${P}stageKey`;
  else if (all.some((o, j) => j < i && o.key === s.key)) e[at("key")] = `${P}stageKeyDup`;
  if (s.executor === "") e[at("executor")] = `${P}executor`;
  if (s.instruction.length > STAGE_INSTRUCTION_MAX) e[at("instruction")] = `${P}tooLong`;
  validateOutput(s, at, e);
  if (s.real && !canRealAction(all, i)) e[at("real_action")] = `${P}realAction`;
  if (s.answerer !== "starter" && s.answererId === "") e[at("answerer")] = `${P}answerer`;
  if (!inRange(s.timeout, STAGE_TIMEOUT_S.min, STAGE_TIMEOUT_S.max))
    e[at("timeout_s")] = `${P}timeout`;
  if (!budgetOk(s.budget)) e[at("token_budget")] = `${P}budget`;
}

/** Validate toàn bản nháp. `forEnable` ⇒ thêm luật "bật": mọi giai đoạn có người kiểm phải có Group. */
export function validateDraft(d: DefDraft, forEnable = d.enabled): DraftErrors {
  const e: DraftErrors = {};
  if (d.name.trim() === "" || d.name.trim().length > PROCESS_NAME_MAX) e.name = `${P}nameRequired`;
  if (!PROCESS_KEY_RE.test(d.key)) e.key = `${P}keyFormat`;
  if (d.description.length > PROCESS_DESC_MAX) e.description = `${P}tooLong`;
  if (d.hint.length > PROCESS_DESC_MAX) e.input_hint = `${P}tooLong`;
  if (d.groupIds.length > PROCESS_RUN_GROUPS_MAX) e.run_group_ids = `${P}tooMany`;
  if (!budgetOk(d.budget)) e.token_budget = `${P}budget`;
  if (d.stages.length < 1 || d.stages.length > PROCESS_STAGES_MAX) e.stages = `${P}stageCount`;
  d.stages.forEach((s, i) => {
    validateStage(s, i, d.stages, e);
    if (forEnable && s.after === "review" && s.groupId === "")
      e[`stages.${i}.after.group_id`] = "process.admin.apiError.PROCESS_DEF_INCOMPLETE";
  });
  validateSourcesPart(d, e);
  return e;
}

/** Chỉ số giai đoạn nhắc tới trong các path lỗi (để mở accordion). */
export function stageIndexesOf(paths: Iterable<string>): number[] {
  const out = new Set<number>();
  for (const p of paths) {
    const m = /^stages\.(\d+)(\.|$)/.exec(p);
    if (m) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** Path lỗi từ Hub (`PROCESS_DEF_INVALID/INCOMPLETE{paths}`) → lỗi theo ô. */
export function errorsFromServer(paths: readonly string[], key: string): DraftErrors {
  return Object.fromEntries(paths.map((p) => [p, key]));
}

/** `ProcessDef` đọc từ Hub → body PUT (bỏ id, tenant, version…). */
export function defToInput(d: ProcessDef): ProcessDefInput {
  return {
    key: d.key,
    name: d.name,
    description: d.description,
    input_hint: d.input_hint,
    run_group_ids: d.run_group_ids,
    stages: d.stages,
    token_budget: d.token_budget,
    enabled: d.enabled,
    sources: d.sources,
    inputs: d.inputs,
  };
}

/** Chuỗi so sánh "đã sửa chưa" (bỏ `uid` cục bộ). */
export const snapshot = (d: DefDraft): string =>
  JSON.stringify({
    ...d,
    stages: d.stages.map(({ uid: _uid, ...s }) => s),
    inputs: d.inputs.map(({ uid: _uid, ...i }) => i),
  });

/** Sửa giai đoạn `i`; còn `keyAuto` mà đổi tên ⇒ mã giai đoạn sinh lại (không trùng mã khác). */
export function patchStage(stages: StageDraft[], i: number, p: Partial<StageDraft>): StageDraft[] {
  return stages.map((s, j) => {
    if (j !== i) return s;
    const next = { ...s, ...p };
    if (next.keyAuto && p.name !== undefined) {
      const others = stages.filter((_, k) => k !== i).map((o) => o.key);
      next.key = slugKey(p.name, others);
    }
    return next;
  });
}
