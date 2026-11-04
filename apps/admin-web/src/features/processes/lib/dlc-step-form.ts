// dlc-step-library · bản nháp form "Bước DLC" (thư viện bước mẫu): khoá tự sinh từ tên (sửa tay ⇒ thôi tự sinh), bật/tắt cổng duyệt
// kéo theo Group mặc định + "Từ chối ⇒ làm lại chính bước", lỗi ô theo contract (zod) ⇒ khoá i18n. Thuần.
import {
  DLC_STEP_LIMITS,
  type DlcStepTemplate,
  type DlcStepTemplateInput,
  DlcStepTemplateInputSchema,
} from "@ai/contracts/hub-admin";
import { DLC_GROUP_EDITOR } from "./dlc-slot";

export type DlcStepDraft = DlcStepTemplateInput & { keyAuto: boolean };
const KEY_MAX = 40;

export const blankDlcStep = (): DlcStepDraft => ({
  key: "",
  name: "",
  action: "agent",
  agent_key: null,
  instruction: "",
  gate_group: null,
  reject_to: null,
  max_rounds: DLC_STEP_LIMITS.rounds.default,
  timeout_min: DLC_STEP_LIMITS.timeoutMin.default,
  keyAuto: true,
});

export const draftOf = ({
  id: _i,
  version: _v,
  updated_at: _u,
  ...t
}: DlcStepTemplate): DlcStepDraft => ({
  ...t,
  keyAuto: false,
});

/** Khoá từ tên: bỏ dấu (đ ⇒ d), chữ thường, ký tự khác ⇒ `-`; bắt đầu bằng chữ (số đầu ⇒ thêm `b-`), ≤ 40. */
export function keyFromName(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const k = /^[a-z]/.test(s) ? s : s ? `b-${s}` : "";
  return k.slice(0, KEY_MAX).replace(/-+$/, "");
}

export const withName = (d: DlcStepDraft, name: string): DlcStepDraft => ({
  ...d,
  name,
  key: d.keyAuto ? keyFromName(name) : d.key,
});

/** Bật cổng ⇒ Group `dlc-editor` + Từ chối làm lại chính bước; tắt ⇒ bỏ cả hai. */
export const withGate = (d: DlcStepDraft, on: boolean): DlcStepDraft => ({
  ...d,
  gate_group: on ? (d.gate_group ?? DLC_GROUP_EDITOR) : null,
  reject_to: on ? (d.reject_to ?? "self") : null,
});

export const toInput = ({ keyAuto: _k, ...d }: DlcStepDraft): DlcStepTemplateInput => ({
  ...d,
  name: d.name.trim(),
});

const E = "process.admin.library.dlc.steps.err.";
/** Lỗi ô (trường → khoá i18n), ô đầu tiên lỗi mỗi trường; rỗng ⇒ lưu được. */
export function dlcStepErrors(d: DlcStepDraft): Record<string, string> {
  const r = DlcStepTemplateInputSchema.safeParse(toInput(d));
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) {
    const f = String(i.path[0] ?? "");
    if (f && !out[f]) out[f] = `${E}${f}`;
  }
  return out;
}
