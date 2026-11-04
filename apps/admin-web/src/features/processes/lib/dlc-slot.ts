// dlc-engine · bước DLC trên Canvas của quy trình thư viện (khe `dlc.*`): stage mang `slot.kind = "dlc"` (Hub `fromStages` dựng
// lại `slot_body` từ `slot` + khoá/tên stage rồi biên dịch lại). Một sơ đồ chỉ MỘT loại bước: bước duyệt (`review`, khe hợp đồng)
// và bước DLC không nối với nhau — trộn ⇒ lỗi `KIND_MIX` trên bước khác loại (Hub cũng từ chối). Luật ở đây = luật Hub
// (`packs/dlc/domain/dlc-flow.rules.ts`) phần người sửa được trên form; thuần.
import type { StageDraft } from "./draft-types";

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
/** Agent mặc định của việc (để trống ô agent ⇒ dùng mặc định). */
export const DLC_DEFAULT_AGENT: Readonly<Partial<Record<DlcAction, string>>> = {
  spec: "dlc-spec",
  qc: "dlc-qc",
  verify: "dlc-verify",
};
const AGENT_ACTIONS: ReadonlySet<string> = new Set(["spec", "qc", "verify", "agent"]);
export const dlcUsesAgent = (a: string): boolean => AGENT_ACTIONS.has(a);
/** Việc dùng `max_rounds` (build: số lần thử mỗi việc; verify: số vòng sửa). */
export const dlcUsesRounds = (a: string): boolean => a === "build" || a === "verify";
const NEEDS: Readonly<Partial<Record<string, readonly string[]>>> = {
  qc: ["spec"],
  setup: ["spec"],
  build: ["setup"],
  verify: ["build"],
  deploy: ["build"],
};
export const DLC_ROUNDS = { min: 1, max: 10, default: 3 } as const;
export const DLC_TIMEOUT_MIN = { min: 5, max: 1440, default: 60 } as const;
export const DLC_INSTRUCTION_MAX = 8_000;
export const DLC_GROUP_EDITOR = "dlc-editor";
const GROUP_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type DlcSlot = {
  kind: "dlc";
  key: string;
  name: string;
  action: DlcAction;
  agent_key: string | null;
  instruction: string;
  gate: { group_key: string; back_to: string[] } | null;
  max_rounds: number;
  timeout_min: number;
};

export const isDlcSlotKey = (slot: string | null | undefined): boolean =>
  typeof slot === "string" && slot.startsWith("dlc.");
export const isDlcStep = (s: Pick<StageDraft, "slotRaw">): boolean => s.slotRaw?.kind === "dlc";
export const dlcOf = (s: Pick<StageDraft, "slotRaw">): DlcSlot => s.slotRaw as unknown as DlcSlot;

/** Bước DLC mới (việc `agent`, chưa chọn agent ⇒ form báo thiếu). */
export function newDlcSlot(key: string, name: string): DlcSlot {
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

/** Khoá bước chưa dùng (`d1`, `d2`…). */
export function freeDlcKey(stages: readonly StageDraft[]): string {
  const taken = new Set(stages.map((s) => String(s.slotRaw?.key ?? s.key)));
  let n = stages.length + 1;
  while (taken.has(`d${n}`)) n++;
  return `d${n}`;
}

/** Loại bước của sơ đồ = loại bước người dùng đầu tiên (`dlc` | `review` | `dify` | `esign`); chưa có ⇒ null. */
export function diagramKind(stages: readonly StageDraft[]): string | null {
  const k = stages.map((s) => s.slotRaw?.kind).find((x) => typeof x === "string");
  return typeof k === "string" ? (k === "dlc" ? "dlc" : "review") : null;
}
/** Họ của một stage cho luật trộn: bước DLC ⇒ "dlc"; bước khe khác ⇒ "review"; stage hệ thống / chưa phải bước ⇒ null. */
export const stageFamily = (s: Pick<StageDraft, "slotRaw">): "dlc" | "review" | null =>
  s.slotRaw?.kind === "dlc" ? "dlc" : typeof s.slotRaw?.kind === "string" ? "review" : null;

/** Khoá bước của stage DLC (vắng ⇒ khoá stage). */
const keyOf = (s: StageDraft): string => dlcOf(s).key || s.key;

/**
 * Canvas khe DLC: bước engine = vị trí, khoá stage = khoá bước, không nhánh. Cổng nằm trong `slot.gate` (Hub biên dịch lại từ
 * `slot`); `backTo` của stage = vị trí các bước `gate.back_to` đứng trước (khớp `back_to_steps` Hub dựng) ⇒ canvas vẽ "Từ chối".
 */
export function normalizeDlcStages(stages: readonly StageDraft[]): StageDraft[] {
  const keys = stages.map((s, i) => (isDlcStep(s) ? dlcOf(s).key || `d${i + 1}` : null));
  return stages.map((s, i) => {
    if (!isDlcStep(s)) return { ...s, step: i };
    const slot = { ...dlcOf(s), name: s.name };
    const key = keys[i] as string;
    const after = slot.gate ? ("review" as const) : ("auto" as const);
    const back = (slot.gate?.back_to ?? [])
      .map((k) => keys.indexOf(k))
      .filter((n) => n >= 0 && n < i);
    return {
      ...s,
      key,
      keyAuto: false,
      step: i,
      after,
      backTo: slot.gate ? back : [],
      branch: [],
      slotRaw: { ...slot, key },
    };
  });
}

/** dlc-step-library · bước (cột) đích "Từ chối" của một bước DLC có cổng, theo `gate.back_to` (chỉ bước đứng trước). */
export function dlcBackSteps(s: StageDraft, all: readonly StageDraft[]): number[] {
  const g = isDlcStep(s) ? dlcOf(s).gate : null;
  if (!g) return [];
  return g.back_to.flatMap((k) => {
    const t = all.find((x) => isDlcStep(x) && keyOf(x) === k);
    return t && t.step < s.step ? [t.step] : [];
  });
}

export type DlcRejectLink = { index: number; slot: DlcSlot } | { error: "noGate" | "notEarlier" };

/**
 * dlc-step-library · kéo cổng "Từ chối" của bước `from` thả lên bước `to`: `to` phải là bước DLC ĐỨNG TRƯỚC ⇒ `gate.back_to = [to]`.
 * Không phải hai bước DLC ⇒ null (bỏ qua im lặng). Áp cho MỌI bước có cổng — không phân biệt khoá/việc.
 */
export function linkDlcReject(
  stages: readonly StageDraft[],
  from: string,
  to: string,
): DlcRejectLink | null {
  const index = stages.findIndex((s) => s.uid === from);
  const a = stages[index];
  const b = stages.find((s) => s.uid === to);
  if (!a || !b || !isDlcStep(a) || !isDlcStep(b)) return null;
  const d = dlcOf(a);
  if (!d.gate) return { error: "noGate" };
  if (b.step >= a.step) return { error: "notEarlier" };
  return { index, slot: { ...d, gate: { ...d.gate, back_to: [keyOf(b)] } } };
}

const E = "process.admin.library.dlc.err.";
const int = (n: unknown, lo: number, hi: number) =>
  typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;

/** Lỗi ô của một bước DLC (`dlc.<field>` → khoá i18n). `before` = các bước đứng trước. */
function stepErrors(s: DlcSlot, before: readonly DlcSlot[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!s.name?.trim()) e.name = `${E}NAME_REQUIRED`;
  if (s.action === "agent" && !s.agent_key?.trim()) e.agent_key = `${E}AGENT_REQUIRED`;
  const need = NEEDS[s.action] ?? [];
  if (need.some((a) => !before.some((b) => b.action === a))) e.action = `${E}ORDER_INVALID`;
  if ((s.instruction ?? "").length > DLC_INSTRUCTION_MAX)
    e.instruction = `${E}INSTRUCTION_TOO_LONG`;
  if (!int(s.max_rounds, DLC_ROUNDS.min, DLC_ROUNDS.max)) e.max_rounds = `${E}ROUNDS_INVALID`;
  if (!int(s.timeout_min, DLC_TIMEOUT_MIN.min, DLC_TIMEOUT_MIN.max))
    e.timeout_min = `${E}TIMEOUT_INVALID`;
  if (s.gate && !GROUP_KEY_RE.test(s.gate.group_key ?? "")) e.gate = `${E}GATE_GROUP_INVALID`;
  const keys = new Set(before.map((b) => b.key));
  if (s.gate?.back_to.some((k) => !keys.has(k))) e.back_to = `${E}BACK_TARGET_INVALID`;
  return e;
}

/** Lỗi theo path `stages.<i>.dlc.<field>` cho bản nháp: luật bước DLC + `KIND_MIX` (bước khác loại với sơ đồ). */
export function dlcDraftErrors(stages: readonly StageDraft[]): Record<string, string> {
  const kind = diagramKind(stages);
  if (kind === null || !stages.some(isDlcStep)) return {};
  const out: Record<string, string> = {};
  const seen: DlcSlot[] = [];
  stages.forEach((s, i) => {
    const fam = stageFamily(s);
    if (fam !== null && fam !== kind) out[`stages.${i}.dlc.kind`] = `${E}KIND_MIX`;
    if (!isDlcStep(s)) return;
    const d = dlcOf(s);
    for (const [f, k] of Object.entries(stepErrors({ ...d, name: s.name }, seen)))
      out[`stages.${i}.dlc.${f}`] = k;
    seen.push(d);
  });
  return out;
}
