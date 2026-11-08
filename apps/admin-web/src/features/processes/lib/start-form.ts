// CR-125 · cr125-manual-start-ui · «Bắt đầu bằng phiếu yêu cầu» (node core.start-form) ở trình sửa flow: bản nháp ô phiếu ⇄ `stage.start_form`,
// thêm/gỡ node ở ĐẦU flow, kiểm tra tại chỗ (nhãn, mã ô, mẫu tên). Thuần (không React, không API).

import { FIELD_KEY_RE } from "@ai/contracts/hub-admin";
import {
  isReservedStartKey,
  START_FORM_FIELD_TYPES,
  START_FORM_FIELDS_MAX,
  START_FORM_NODE_KEY,
  type StartFormConfig,
  type StartFormFieldType,
} from "@ai/contracts/modules";
import type { DraftErrors, StageDraft } from "./draft-types";
import { fieldKeyFromLabel } from "./form-fields";
import type { StartFieldDraft, StartFormDraft } from "./start-form.types";

export type { StartFieldDraft, StartFormDraft, StartFormFieldType };
export { START_FORM_FIELD_TYPES, START_FORM_FIELDS_MAX, START_FORM_NODE_KEY };

const E = "process.admin.startForm.err.";
/** Khoá lỗi do `startFormErrors` tính lại mỗi lần render (không giữ lại từ lần Lưu trước). */
export const isStartFormErrKey = (v: string): boolean => v.startsWith(E);

export const isStartForm = (s: Pick<StageDraft, "node">): boolean => s.node === START_FORM_NODE_KEY;

export const blankStartField = (label: string, taken: readonly string[]): StartFieldDraft => ({
  key: fieldKeyFromLabel(label, taken),
  keyAuto: true,
  label,
  type: "text",
  required: false,
  help: "",
});

export const emptyStartForm = (): StartFormDraft => ({
  fields: [],
  starters: "everyone",
  groupKeys: [],
  groupIds: [],
  title: "",
});

export function startFormToDraft(cfg: StartFormConfig): StartFormDraft {
  const g = cfg.starters.kind === "groups" ? cfg.starters : null;
  return {
    fields: cfg.fields.map((f) => ({
      key: f.key,
      keyAuto: false,
      label: f.label,
      type: f.type,
      required: f.required,
      help: f.help ?? "",
    })),
    starters: g ? "groups" : "everyone",
    groupKeys: [...(g?.group_keys ?? [])],
    groupIds: [...(g?.group_ids ?? [])],
    title: cfg.title_template,
  };
}

/** Bản nháp → cấu hình gửi Hub (`stage.start_form`). */
export function startFormToDef(d: StartFormDraft): StartFormConfig {
  return {
    fields: d.fields.map((f) => ({
      key: f.key,
      label: f.label.trim(),
      type: f.type,
      required: f.required,
      ...(f.help.trim() === "" ? {} : { help: f.help.trim() }),
    })),
    starters:
      d.starters === "everyone"
        ? { kind: "everyone" }
        : {
            kind: "groups",
            group_ids: d.groupIds,
            ...(d.groupKeys.length > 0 ? { group_keys: d.groupKeys } : {}),
          },
    title_template: d.title.trim(),
  };
}

/** Thêm một ô (nhãn tạm "Ô n", mã sinh theo nhãn). */
export function addStartField(d: StartFormDraft, label: string): StartFormDraft {
  if (d.fields.length >= START_FORM_FIELDS_MAX) return d;
  const f = blankStartField(
    label,
    d.fields.map((x) => x.key),
  );
  return { ...d, fields: [...d.fields, f] };
}

/** Đổi nhãn ô; còn `keyAuto` ⇒ mã sinh lại theo nhãn (không trùng ô khác). */
export function relabelStartField(d: StartFormDraft, j: number, label: string): StartFormDraft {
  return {
    ...d,
    fields: d.fields.map((f, i) => {
      if (i !== j) return f;
      if (!f.keyAuto) return { ...f, label };
      const others = d.fields.filter((_, k) => k !== j).map((x) => x.key);
      return { ...f, label, key: fieldKeyFromLabel(label, others) };
    }),
  };
}

export function moveStartField(d: StartFormDraft, j: number, dir: -1 | 1): StartFormDraft {
  const k = j + dir;
  if (k < 0 || k >= d.fields.length) return d;
  const fields = [...d.fields];
  [fields[j], fields[k]] = [fields[k] as StartFieldDraft, fields[j] as StartFieldDraft];
  return { ...d, fields };
}

/** Số ô để hiện trên node («Phiếu yêu cầu · 5 ô»). */
export const startFieldCount = (s: Pick<StageDraft, "startForm">): number =>
  s.startForm?.fields.length ?? 0;

/** Kiểm tại chỗ: path `stages.i.start_form[.fields.j.<label|key>|.title_template]` → khoá i18n. */
export function startFormErrors(stages: readonly StageDraft[]): DraftErrors {
  const e: DraftErrors = {};
  stages.forEach((s, i) => {
    const f = s.startForm;
    if (!isStartForm(s) || !f) return;
    const at = (p: string) => `stages.${i}.start_form.${p}`;
    if (f.fields.length === 0) e[at("fields")] = `${E}fieldsMin`;
    const seen = new Set<string>();
    f.fields.forEach((x, j) => {
      if (x.label.trim() === "") e[at(`fields.${j}.label`)] = `${E}labelRequired`;
      if (!FIELD_KEY_RE.test(x.key)) e[at(`fields.${j}.key`)] = `${E}keyInvalid`;
      else if (isReservedStartKey(x.key)) e[at(`fields.${j}.key`)] = `${E}START_FIELD_RESERVED`;
      else if (seen.has(x.key)) e[at(`fields.${j}.key`)] = `${E}keyDup`;
      seen.add(x.key);
    });
    if (f.title.trim() === "") e[at("title_template")] = `${E}titleRequired`;
    if (f.starters === "groups" && f.groupKeys.length === 0 && f.groupIds.length === 0)
      e[at("starters")] = `${E}startersGroups`;
  });
  return e;
}
