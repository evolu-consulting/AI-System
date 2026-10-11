// ADM-FR-69 · HUB-FR-121/124/125 · P-b FS-6: form nguồn / đầu vào / must_know của editor quy trình (hàm thuần, không React).
// Bản nháp giữ dạng nhập tay (allowlist, lựa chọn, must_know = textarea mỗi dòng một mục); `formToDef` đổi về contract.
import {
  DEF_INPUTS_MAX,
  DEF_SOURCES_MAX,
  INPUT_LABEL_MAX,
  INPUT_OPTION_LEN,
  INPUT_OPTIONS_MAX,
  type INPUT_TYPES,
  MUST_KNOW_LEN,
  MUST_KNOW_MAX,
  type ProcessInputDef,
  SOURCE_GLOB_MAX,
  SOURCE_KEY_RE,
  STAGE_ALLOWLIST_MAX,
  STAGE_SOURCES_MAX,
  type StageSource,
} from "@ai/contracts/hub-admin";

export type InputType = (typeof INPUT_TYPES)[number];
export type InputDraft = {
  /** Khoá React cục bộ (không gửi đi). */
  uid: string;
  key: string;
  label: string;
  type: InputType;
  required: boolean;
  /** Chỉ `select`: mỗi dòng một giá trị. */
  options: string;
};
export type StageSourceDraft = { key: string; allowlist: string };

/** Phần của `StageDraft` / `DefDraft` mà module này đọc (cấu trúc, tránh phụ thuộc vòng với `def-form`). */
export type StageSourcesPart = { sources: StageSourceDraft[]; mustKnow: string };
export type DefSourcesPart = {
  sources: string[];
  inputs: InputDraft[];
  stages: readonly StageSourcesPart[];
};
type Errors = Record<string, string>;

const E = "process.admin.editor.";
let seq = 0;
export const nextInputUid = (): string => `i${++seq}`;

const lines = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

// ── def ⇄ form ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const stageSourcesToDraft = (src: readonly StageSource[]): StageSourceDraft[] =>
  src.map((s) => ({ key: s.source_key, allowlist: s.allowlist.join("\n") }));

export const stageSourcesToDef = (src: readonly StageSourceDraft[]): StageSource[] =>
  src.map((s) => ({ source_key: s.key, allowlist: lines(s.allowlist) }));

export const mustKnowToDraft = (m: readonly string[]): string => m.join("\n");
export const mustKnowToDef = (s: string): string[] => lines(s);

export const inputsToDraft = (inputs: readonly ProcessInputDef[]): InputDraft[] =>
  inputs.map((i) => ({
    uid: nextInputUid(),
    key: i.key,
    label: i.label,
    type: i.type,
    required: i.required,
    options: (i.options ?? []).join("\n"),
  }));

export const inputsToDef = (inputs: readonly InputDraft[]): ProcessInputDef[] =>
  inputs.map((i) => ({
    key: i.key,
    label: i.label.trim(),
    type: i.type,
    required: i.required,
    ...(i.type === "select" ? { options: lines(i.options) } : {}),
  }));

export const emptyInput = (): InputDraft => ({
  uid: nextInputUid(),
  key: "",
  label: "",
  type: "text",
  required: false,
  options: "",
});

// ── nguồn dùng / bỏ ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Số thứ tự (1-based) của giai đoạn đầu tiên đang dùng nguồn `key`; không có ⇒ null. */
export function firstStageUsing(def: Pick<DefSourcesPart, "stages">, key: string): number | null {
  const i = def.stages.findIndex((s) => s.sources.some((x) => x.key === key));
  return i < 0 ? null : i + 1;
}

/** Nguồn khai báo ở quy trình nhưng chưa giai đoạn nào dùng. */
export const unusedSources = (def: Pick<DefSourcesPart, "sources" | "stages">): string[] =>
  def.sources.filter((k) => firstStageUsing(def, k) === null);

/** Bỏ nguồn khỏi quy trình chỉ khi không giai đoạn nào còn dùng. */
export const canDropSource = (def: Pick<DefSourcesPart, "sources" | "stages">, key: string) =>
  firstStageUsing(def, key) === null;

// ── validate (khớp contract; câu lỗi ở i18n §4) ─────────────────────────────────────────────────────────────────────
const globBad = (g: string): boolean =>
  g.length > SOURCE_GLOB_MAX ||
  g.startsWith("/") ||
  g.split("/").includes("..") ||
  g.includes("\0");

function validateInputs(inputs: readonly InputDraft[], e: Errors) {
  if (inputs.length > DEF_INPUTS_MAX) e.inputs = `${E}err.input.max`;
  inputs.forEach((x, j) => {
    const at = (f: string) => `inputs.${j}.${f}`;
    if (!SOURCE_KEY_RE.test(x.key)) e[at("key")] = `${E}err.input.key`;
    else if (inputs.some((o, k) => k < j && o.key === x.key)) e[at("key")] = `${E}err.input.keyDup`;
    if (x.label.trim() === "" || x.label.trim().length > INPUT_LABEL_MAX)
      e[at("label")] = `${E}err.input.label`;
    if (x.type !== "select") return;
    const opts = lines(x.options);
    const bad =
      opts.length < 1 ||
      opts.length > INPUT_OPTIONS_MAX ||
      opts.some((o) => o.length > INPUT_OPTION_LEN) ||
      new Set(opts).size !== opts.length;
    if (bad) e[at("options")] = `${E}err.input.options`;
  });
}

function validateStageSources(def: DefSourcesPart, e: Errors) {
  def.stages.forEach((s, i) => {
    const at = (f: string) => `stages.${i}.${f}`;
    if (s.sources.length > STAGE_SOURCES_MAX) e[at("sources")] = `${E}stageSources.max`;
    s.sources.forEach((src, j) => {
      if (!def.sources.includes(src.key))
        e[at(`sources.${j}.source_key`)] = `${E}stageSources.notInDef`;
      const g = lines(src.allowlist);
      if (g.length > STAGE_ALLOWLIST_MAX) e[at(`sources.${j}.allowlist`)] = `${E}err.glob.max`;
      else if (g.some(globBad)) e[at(`sources.${j}.allowlist`)] = `${E}err.glob.invalid`;
    });
    const mk = lines(s.mustKnow);
    if (mk.length > MUST_KNOW_MAX) e[at("must_know")] = `${E}err.mustKnow.max`;
    else if (mk.some((m) => m.length > MUST_KNOW_LEN))
      e[at("must_know")] = `${E}err.mustKnow.tooLong`;
  });
}

/** Gộp lỗi nguồn / đầu vào / must_know vào `e` (path như contract). */
export function validateSourcesPart(def: DefSourcesPart, e: Errors): void {
  if (def.sources.length > DEF_SOURCES_MAX) e.sources = `${E}sources.max`;
  validateInputs(def.inputs, e);
  validateStageSources(def, e);
}
